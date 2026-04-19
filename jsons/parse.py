import json
from datetime import datetime

data = json.load(open("./trains.json", encoding="utf-8"))

print(len(data["segments"]))

seg = []

now = datetime.now().astimezone()

for t in data["segments"]:
    if t["departure"] and t["arrival"] and datetime.fromisoformat(t["departure"]) <= now <= datetime.fromisoformat(t["arrival"]):
        seg.append(t)

data["segments"] = seg

print(len(data["segments"]))