import assert from "node:assert/strict";
import { compareActivityDisplayOrder } from "../activity-order.js";

const activities = [
  { id: "done-soon", due: "2026-10-30T22:59:00Z" },
  { id: "pending-later", due: "2026-11-27T22:00:00Z" },
  { id: "pending-expired", due: "2026-10-10T22:00:00Z" },
  { id: "done-old", due: "2026-10-01T22:00:00Z" },
  { id: "pending-soon", due: "2026-10-30T23:59:00Z" }
];
const doneIds = new Set(["done-soon","done-old"]);
const due = activity => activity.due;
const status = dueValue => ({
  status: new Date(dueValue) < new Date("2026-10-30T21:00:00Z") ? "expired" : "normal"
});
const sort = (items, done) => items.slice().sort((a, b) =>
  compareActivityDisplayOrder(a, b, done, due, status)).map(a=>a.id);

assert.deepEqual(sort(activities,doneIds),[
 "pending-soon","pending-later","pending-expired","done-soon","done-old"
]);
assert.deepEqual(sort(activities.filter(a=>doneIds.has(a.id)),doneIds),["done-soon","done-old"]);
assert.deepEqual(sort(activities.filter(a=>!doneIds.has(a.id)),doneIds),["pending-soon","pending-later","pending-expired"]);
assert.deepEqual(sort(activities.filter(a=>status(a.due).status==="expired"),doneIds),["pending-expired","done-old"]);
assert.deepEqual(sort(activities,new Set()),[
 "done-soon","pending-soon","pending-later","pending-expired","done-old"
]);
console.log("OK: pending cards before completed in all filters, deadlines retain priority.");
