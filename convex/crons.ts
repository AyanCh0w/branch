import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
// 144 calls a day; keeps presence tables small without per-write cleanup reads.
crons.interval('sweep expired presence', { minutes: 10 }, internal.collaboration.sweep, {});
export default crons;
