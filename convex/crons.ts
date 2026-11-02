import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// recovers deliveries left pending by a crash or missing config
crons.interval("sweep pending deliveries", { minutes: 5 }, internal.notifications.sweepPending);

export default crons;
