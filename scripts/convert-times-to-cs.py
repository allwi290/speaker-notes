#!/usr/bin/env python3
"""
Convert recorded demo data from formatted time strings (MM:SS, H:MM:SS, +MM:SS)
to centiseconds in number format.

Fields converted:
  - result: "43:18" → 259800 (centiseconds)
  - timeplus: "+01:23" → 8300, "+00:00" → 0, "+" → 0, "" → ""

Split fields (splits[code], splits[code_timeplus]) are already centiseconds.

Usage:
    python3 scripts/convert-times-to-cs.py data/35680
"""

import json
import re
import sys
from pathlib import Path


def time_str_to_cs(s):
    """
    Convert a time string like "MM:SS", "H:MM:SS", or "M:SS" to centiseconds.
    Returns None if the string is empty or not parseable.
    """
    if not s or not isinstance(s, str):
        return None

    s = s.strip()
    if not s:
        return None

    # Already a number
    try:
        n = int(s)
        return n
    except ValueError:
        pass

    parts = s.split(':')
    if len(parts) == 2:
        # MM:SS or M:SS
        try:
            m, sec = int(parts[0]), int(parts[1])
            return (m * 60 + sec) * 100
        except ValueError:
            return None
    elif len(parts) == 3:
        # H:MM:SS
        try:
            h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
            return (h * 3600 + m * 60 + sec) * 100
        except ValueError:
            return None

    return None


def timeplus_str_to_cs(s):
    """
    Convert a timeplus string like "+01:23", "+00:00", "+", "" to centiseconds.
    Returns the original value if not a formatted string.
    """
    if not s or not isinstance(s, str):
        return s

    s = s.strip()
    if s == '' or s == '+':
        return 0

    # Strip leading +
    if s.startswith('+'):
        inner = s[1:]
    else:
        inner = s

    cs = time_str_to_cs(inner)
    if cs is not None:
        return cs

    return s  # return as-is if not parseable


def convert_runner(runner):
    """Convert a single runner's result and timeplus fields."""
    changed = False

    # Convert result
    result = runner.get('result', '')
    if isinstance(result, str) and ':' in result:
        cs = time_str_to_cs(result)
        if cs is not None:
            runner['result'] = cs
            changed = True

    # Convert timeplus
    timeplus = runner.get('timeplus', '')
    if isinstance(timeplus, str) and ('+' in timeplus or ':' in timeplus):
        runner['timeplus'] = timeplus_str_to_cs(timeplus)
        changed = True

    return changed


def convert_file(filepath):
    """Convert all runner times in a single JSON file. Returns True if modified."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    response = data.get('response', data)
    results = response.get('results', [])

    modified = False
    for runner in results:
        if convert_runner(runner):
            modified = True

    if modified:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    return modified


def main():
    if len(sys.argv) < 2:
        print(f'Usage: {sys.argv[0]} <comp_dir>', file=sys.stderr)
        sys.exit(1)

    comp_dir = Path(sys.argv[1])
    cr_path = comp_dir / 'classresults'

    if not cr_path.is_dir():
        print(f'Error: {cr_path} not found', file=sys.stderr)
        sys.exit(1)

    total_files = 0
    modified_files = 0

    for cls_dir in sorted(cr_path.iterdir()):
        if not cls_dir.is_dir():
            continue

        for filepath in sorted(cls_dir.glob('*.json')):
            total_files += 1
            if convert_file(filepath):
                modified_files += 1

    print(f'Processed {total_files} files, modified {modified_files}')


if __name__ == '__main__':
    main()
