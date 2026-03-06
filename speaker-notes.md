# Speaker notes

I would like to create a webpage that can be uses as speaker notes during an orienteering event. The webpage should be displayed on, at least, a full hd stand alone display or laptop and should be readable from at least 1 meter.

New events should animate in with an audio chime and the list should have auto scroll

The page should be divided into two parts, the upper parts should displayed the latest event and the lower parts should display upcoming predicted events.

## Definitions

Event is defined as a runner event, i.e a change in a runner's state — a new split time, a finish, or a status change (DNS, DNF, DSQ, etc.).

Top N means the N runners with the lowest cumulative time at the most recent split control they have passed, or the final result if finished.

## Latest events

The latest event part should display the latest event for the top 4 (should be able to change as a setting) runners per classes (default should all classes be followed but it should be able to select which classes that should be followed or not as a setting) in the competition sorted time wise.
The 10 latest event should be listed

Data that should be display at each row
Field               Example
Time                14:32:57
Class               Herrar
Runner              Bruno Godefroy
Club                OK Ravinen
Control             Radio K65
Place at control    2
Time behind leader  +0:11

Add a visual indicator (e.g., colored border or club logo) for club-followed runners and confirm they bypass the "top N" filter. They should not bypass the prediction events

Show status changes (DNF, DSQ, MP) for top-N and club-followed runners as latest events.

## Predicted events

To be able to predict event we need at least have one split time to be able to predict next event and a previous runner to compare too. A predicted event should be there until it happens or at most for 15 minutes.
We should have predicted events for the top 4 runners per class (same settings and filtering as for the latest events part)
At most the 5 most relevant predictions should be visible

Data that should be display at each row
Field               Example
Predicted time      14:32:57
Class               Herrar
Runner              Bruno Godefroy
Club                OK Ravinen
Target Control      Radio K65
Confidence          minutes

### Runner event handling

When we receives an update for runner, do the following:
    - Is the runner present on the prediction part remove the runner from that part
    - The runners current position is in the top category then display it on the latest event part and the create a prediction on the runners next event.
    - The runners current position is not in the top category but it previously was then display it on the latest event parts.

### Prediction of runner

To be able to predict a runners next event we need at least one split time and another runner to compare to. Its enough with a linear prediction, e.g.

Given runner A has passed control C₁ at time T₁, and reference runner B has passed both C₁ (at time Tᵦ₁) and C₂ (at time Tᵦ₂):

Predicted time for A at C₂ = T₁ + (Tᵦ₂ − Tᵦ₁) × (A's pace ratio)

Where pace ratio = A's split to C₁ / B's split to C₁

Reference runner: The fastest runner in the class who has already passed the target control.

A finish prediction should be included when its relevant

## User workflows

The user starts to select which competition he or she should follow. Only competitions for the current date should be shown. Then selects which classes he or she should follow, defaults to all classes. The selects additional clubs to follow, none selected as default. This is used to show all the events for specific club independent of the runners position in the competition

## Surveillance of internet connection

A status of the internet connection should be visible in three colors, green, yellow and red, a timestamp when latest runner data has been received and the current browser timestamp (regular update every second)

Color   Condition
🟢 Green   Successful api-response received within the last 30 seconds (not modified content is also regarded as successful api response)
🟡 Yellow   No successful api response received for 30–90 seconds
🔴 Red   No successful api response for 90+ seconds OR fetch errors

## Architectural notes

The app should only be a webpage. All the data will be fetch from [https://liveresultat.orientering.se/api.php](https://liveresultat.orientering.se/api.php)
The app should not loose its state due to network connection issues or page reloads. All settings (competition, classes, clubs, top-N) are persisted in localStorage

### API introduction

General api documentation can be found here: [https://liveresults.github.io/documentation/api.html](https://liveresults.github.io/documentation/api.html)

Base url for all endpoints is [https://liveresultat.orientering.se/api.php](https://liveresultat.orientering.se/api.php)

#### API cache handling

Most methods in the API contains the possibility to supply a last_hash parameter in the query to only receive a new response if something have changed. This way data transfer out from the servers can be minimized and data cached better to please use this functionality!

When data have not changed the API will return this response instead

```json
{ "status" : "NOT MODIFIED" } 
```

You don’t need to calculate the hash yourself, it’s returned in the responses as a property

```json
{ 
  "hash" : "abcdef....." 
}
```

#### Get competition

Query parameters
[?method=getcompetitions](?method=getcompetitions)

Example response:

```json
{ "competitions" : [  
     {   "id" : 10278, 
         "name" : "Demo #1", 
         "organizer" : "TestOrganizer", 
         "date" : "2012-06-01",
         "timediff" : 0},
    { "id" : 10279, 
      "name" : "Demo #2", 
      "organizer" : "TestOrganizer", 
       "date" : "2012-06-02",
       "timediff" : 1,
       "multidaystage" : 1,
       "multidayfirstday" : 10278
    }
]}
```

#### Get Classes

Query parameters
[?method=getclasses&comp=XXXX&last_hash=abcdefg](?method=getclasses&comp=XXXX&last_hash=abcdefg)

Example response:

```json
{
 "status": "OK", 
 "classes" : [
         {"className": "Öppen-1"},
         {"className": "Öppen-10"},
        {"className": "Öppen-8"}], 
 "hash": "84b1fdfe67a524a1580132baa174cce1"
}
```

#### Get Events

To get the latest event the following query parameters need to be fetched on regular basis. The endpoint is updated with new data at most every 15 seconds.
Each competition and class must be polled separately on regular basis (i.e. every 15 seconds)

When following many classes spread out the request evenly within the time window, have a circuit breaker and use retries with backoff.

[?comp=10259&method=getclassresults&unformattedTimes=true&class=Öppen-1](?comp=10259&method=getclassresults&unformattedTimes=true&class=Öppen-1)

When using `unformattedTimes=true` all timestamps are in centi seconds

Example response:

``` json
{
  "timestamp": "2026-02-07T09:10:16.254Z",
  "lastHashUsed": "cad387fa1259e1ab77ca2dbdf945b087",
  "statusCode": 200,
  "response": {
    "status": "OK",
    "className": "Herrar",
    "splitcontrols": [
      {
        "code": 1065,
        "name": "Radio K65"
      },
      {
        "code": 1050,
        "name": "Radio K50"
      },
      {
        "code": 1074,
        "name": "Radio K74"
      },
      {
        "code": 1090,
        "name": "Radio K90"
      }
    ],
    "results": [
      {
        "place": "",
        "name": "Bruno Godefroy",
        "club": "OK Ravinen",
        "result": "",
        "status": 9,
        "timeplus": "+",
        "progress": 60,
        "splits": {
          "1050": "",
          "1065": 85900,
          "1074": 226300,
          "1090": "",
          "1065_status": 0,
          "1065_place": 13,
          "1065_timeplus": 56300,
          "1050_status": 1,
          "1050_place": "",
          "1074_status": 0,
          "1074_place": 8,
          "1074_timeplus": 114500,
          "1090_status": 1,
          "1090_place": ""
        },
        "start": 3426000,
        "DT_RowClass": "new_result"
      }
   ],
   "hash": "883fae6e4b8f0727b6ffabb7c403277c"
}
```

This is how getclassresults changes for a runner during a competition

| Property | 10:02:55 | 14:25:33 | 14:27:40 | 14:32:57 | 14:35:03 | 14:44:01 | 14:46:07 | 14:48:45 | 14:50:52 | 15:10:22 | 15:11:57 | 15:14:04 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **status** | `10` | → `9` | | | | | | | | | → `0` | |
| **progress** | `0` | | | → `20` | | → `40` | | → `60` | | → `80` | → `100` | |
| **place** | `""` | | | | | | | | | | → `"1"` | |
| **result** | `""` | | | | | | | | | | → `"258018"` | |
| **timeplus** | `"+"` | | | | | | | | | | → `"0"` | |
| **DT_RowClass** | — | + `new_result` | removed | + `new_result` | removed | + `new_result` | removed | + `new_result` | removed | + `new_result` | `new_result` | removed |
| **1065** (split) | `""` | | | → `26900` | | | | | | | | |
| **1065_status** | `1` | | | → `0` | | | | | | | | |
| **1065_place** | `""` | | | → `2` | | | | | | | | |
| **1065_timeplus** | — | | | + `1100` | | | | | | | | |
| **1050** (split) | `""` | | | | | → `94800` | | | | | | |
| **1050_status** | `1` | | | | | → `0` | | | | | | |
| **1050_place** | `""` | | | | | → `18` | | | | | | |
| **1050_timeplus** | — | | | | | + `29100` | | | | | | |
| **1074** (split) | `""` | | | | | | | → `122700` | | | | |
| **1074_status** | `1` | | | | | | | → `0` | | | | |
| **1074_place** | `""` | | | | | | | → `8` | | | | |
| **1074_timeplus** | — | | | | | | | + `17500` | | | | |
| **1090** (split) | `""` | | | | | | | | | → `252700` | | |
| **1090_status** | `1` | | | | | | | | | → `0` | | |
| **1090_place** | `""` | | | | | | | | | → `1` | | |
| **1090_timeplus** | — | | | | | | | | | + `0` | | |

**Key observations:**

- The first update (10:02:55) is the **initial state** (not yet started, status=10).
- At 14:25:33 status changes to `9` (started/running). The `DT_RowClass: "new_result"` flag toggles on/off in pairs — it marks "something changed" and is cleared on the next poll.
- Splits arrive in order: **1065** → **1050** → **1074** → **1090**, each bumping progress by 20%.
- At 15:11:57 the runner **finishes**: status → `0`, result `"43:18"`, place `"1"`, timeplus `"+00:00"` — **1st place**.
- Unchanged properties (`name`, `club`, `start`) are omitted from the table.

**Runner status:**

0 - OK
1 - DNS (Did Not Start)
2 - DNF (Did not finish)
3 - MP (Missing Punch)
4 - DSQ (Disqualified)
5 - OT (Over (max) time)
9 - Not Started Yet
10 - Not Started Yet
11 - Walk Over (Resigned before the race started)
12 - Moved up (The runner have been moved to a higher class)

## Data Model (suggested addition)

### RunnerState (per class, per runner)

- name, club, className
- status (0–12)
- currentProgress (0–100)
- splits: Map<controlCode, {time, place, timeplus}>
- previousSplits: (snapshot from last poll, for change detection)
- result, place, timeplus (when finished)

### LatestEvent

- timestamp (wall-clock when detected)
- runner, class, club
- type: "split" | "finish" | "status_change"
- control, place, timeplus
- expiresAt (auto-remove after X minutes?)

### Prediction

- runner, class, club
- targetControl, predictedTime
- referenceRunner
- createdAt, expiresAt (max 15 min)
