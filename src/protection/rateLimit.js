const store = new Map();

function check(key, maxEvents, windowMs) {
  const now = Date.now();
  if (!store.has(key)) store.set(key, { events: [], warned: false });
  const entry = store.get(key);
  entry.events = entry.events.filter(t => now - t < windowMs);
  entry.events.push(now);
  const count    = entry.events.length;
  const exceeded = count > maxEvents;
  return { exceeded, count, warned: entry.warned };
}

function setWarned(key) {
  if (store.has(key)) store.get(key).warned = true;
}

function reset(key) { store.delete(key); }

function cleanup(windowMs = 60000) {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    entry.events = entry.events.filter(t => now - t < windowMs);
    if (entry.events.length === 0) store.delete(key);
  }
}

setInterval(() => cleanup(5 * 60 * 1000), 5 * 60 * 1000);

module.exports = { check, setWarned, reset, cleanup };
