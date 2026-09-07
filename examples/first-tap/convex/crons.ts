import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "abandon unattended matches",
  { minutes: 1 },
  internal.maintenance.sweepAbandoned,
  {},
);
export default crons;
