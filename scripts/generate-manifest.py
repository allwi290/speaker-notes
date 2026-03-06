#!/usr/bin/env python3
"""
Generate manifest.json and optionally a gzipped inline-data bundle
for a recorded competition's demo data.

Usage:
    python3 scripts/generate-manifest.py data/35680 [--name "Demo"] [--bundle]

The manifest (always generated) contains file references:
    { "timestamp": ..., "class": "D12", "file": "classresults/D12/data_....json" }

The bundle (--bundle flag) embeds the response data inline:
    { "timestamp": ..., "class": "D12", "data": { className, splitcontrols, results, ... } }

The bundle is gzipped and can be loaded in the browser with DecompressionStream.
"""

import argparse
import gzip
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_filename_timestamp(filename):
    """Parse timestamp from filename → epoch milliseconds or None."""
    m = re.match(
        r'data_(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2}):(\d{2})_(.+)\.json',
        filename,
    )
    if not m:
        return None
    year, month, day, hour, minute, second = (int(m.group(i)) for i in range(1, 7))
    dt = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def parse_iso_timestamp(iso_str):
    """Parse ISO 8601 timestamp → epoch milliseconds."""
    iso_str = iso_str.replace('Z', '+00:00')
    dt = datetime.fromisoformat(iso_str)
    return int(dt.timestamp() * 1000)


def collect_clubs(results):
    """Extract unique club names from results array."""
    clubs = set()
    for r in results:
        club = r.get('club', '').strip()
        if club:
            clubs.add(club)
    return clubs


def build_manifest(comp_dir):
    """
    Build the manifest dict for a competition directory.
    Returns (manifest, file_data) where file_data maps relative paths
    to the inner response objects (for bundle creation).
    """
    comp_path = Path(comp_dir)
    cr_path = comp_path / 'classresults'

    if not cr_path.is_dir():
        print(f'Error: {cr_path} not found', file=sys.stderr)
        sys.exit(1)

    comp_id = int(comp_path.name)
    class_names = []
    all_clubs = set()
    timeline = []
    file_data = {}  # rel_path → inner response data
    comp_date = None

    for cls_dir in sorted(cr_path.iterdir()):
        if not cls_dir.is_dir():
            continue

        cls_name = cls_dir.name
        json_files = sorted(f for f in cls_dir.iterdir() if f.suffix == '.json')
        if not json_files:
            continue

        class_names.append(cls_name)

        for filepath in json_files:
            ts_ms = parse_filename_timestamp(filepath.name)
            if ts_ms is None:
                print(f'  Warning: cannot parse timestamp from {filepath.name}, skipping')
                continue

            try:
                raw = json.loads(filepath.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, IOError) as e:
                print(f'  Warning: failed to read {filepath}: {e}, skipping')
                continue

            # Prefer ISO timestamp from file if available
            iso_ts = raw.get('timestamp')
            if iso_ts:
                ts_ms = parse_iso_timestamp(iso_ts)

            if comp_date is None and iso_ts:
                comp_date = iso_ts[:10]

            # Extract inner response (what getClassResults returns)
            response = raw.get('response', raw)

            # Collect clubs
            results = response.get('results', [])
            all_clubs.update(collect_clubs(results))

            rel_path = f'classresults/{cls_name}/{filepath.name}'
            timeline.append({
                'timestamp': ts_ms,
                'class': cls_name,
                'file': rel_path,
            })

            # Store inner response for bundle creation
            file_data[rel_path] = response

    # Sort timeline chronologically, then by class name for stability
    timeline.sort(key=lambda e: (e['timestamp'], e['class']))

    manifest = {
        'competitionId': comp_id,
        'competitionName': f'Competition {comp_id} (Demo)',
        'date': comp_date or 'unknown',
        'classes': class_names,
        'clubs': sorted(all_clubs),
        'timeline': timeline,
    }

    return manifest, file_data


def create_bundle(manifest, file_data, bundle_path):
    """
    Create a gzipped JSON bundle with inline data.
    Same structure as manifest but timeline entries have 'data' instead of 'file'.
    """
    bundle = {
        'competitionId': manifest['competitionId'],
        'competitionName': manifest['competitionName'],
        'date': manifest['date'],
        'classes': manifest['classes'],
        'clubs': manifest['clubs'],
        'timeline': [],
    }

    missing = 0
    for entry in manifest['timeline']:
        data = file_data.get(entry['file'])
        if data is None:
            missing += 1
            continue
        bundle['timeline'].append({
            'timestamp': entry['timestamp'],
            'class': entry['class'],
            'data': data,
        })

    bundle_json = json.dumps(bundle, separators=(',', ':'), ensure_ascii=False)

    with gzip.open(bundle_path, 'wt', encoding='utf-8', compresslevel=9) as gz:
        gz.write(bundle_json)

    raw_size = len(bundle_json.encode('utf-8'))
    gz_size = Path(bundle_path).stat().st_size
    ratio = (1 - gz_size / raw_size) * 100 if raw_size > 0 else 0
    print(f'  Bundle:   {raw_size / 1024 / 1024:.1f} MB raw → {gz_size / 1024 / 1024:.1f} MB gzipped ({ratio:.1f}% reduction)')
    print(f'  Saved to: {bundle_path}')
    if missing:
        print(f'  Warning:  {missing} timeline entries had no file data')

    return bundle_path


def main():
    parser = argparse.ArgumentParser(
        description='Generate demo manifest and optional gzipped bundle'
    )
    parser.add_argument(
        'comp_dir',
        help='Path to competition data directory (e.g. data/35680)',
    )
    parser.add_argument('--name', help='Competition name for the manifest')
    parser.add_argument(
        '--bundle', action='store_true',
        help='Also create bundle.json.gz with inline data',
    )
    args = parser.parse_args()

    comp_dir = Path(args.comp_dir)
    if not comp_dir.is_dir():
        print(f'Error: {comp_dir} not found', file=sys.stderr)
        sys.exit(1)

    print(f'Processing {comp_dir} ...')
    manifest, file_data = build_manifest(comp_dir)

    if args.name:
        manifest['competitionName'] = args.name

    # Always write manifest.json (with file references, no inline data)
    manifest_path = comp_dir / 'manifest.json'
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'  Manifest: {manifest_path}')
    print(f'  Classes:  {len(manifest["classes"])}')
    print(f'  Clubs:    {len(manifest["clubs"])}')
    print(f'  Timeline: {len(manifest["timeline"])} entries')

    # Optionally create the gzipped inline-data bundle
    if args.bundle:
        bundle_path = comp_dir / 'bundle.json.gz'
        create_bundle(manifest, file_data, bundle_path)

    print('Done.')


if __name__ == '__main__':
    main()
