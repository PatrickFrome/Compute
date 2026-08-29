const configured = Number(process.env.A2_CANARY_CAPABILITY_EPOCH || "0");
const floor = Number.isFinite(configured) ? configured : 0;
process.env.A2_CANARY_CAPABILITY_EPOCH = String(Math.max(floor, Date.now()));

await import("./a2_ingress_canary.js");
