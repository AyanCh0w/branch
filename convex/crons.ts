import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.hourly('remove expired agent data and revoked connections', { minuteUTC: 17 }, internal.maintenance.cleanup, {});
export default crons;
