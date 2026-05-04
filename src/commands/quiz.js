const QUESTIONS = [
  { q: "What is 5 + 7?", a: "12" },
  { q: "Capital of France?", a: "paris" },
  { q: "What color is the sky?", a: "blue" },
  { q: "What is 10 * 10?", a: "100" },
  { q: "How many days in a week?", a: "7" },
  { q: "What is 2^8?", a: "256" },
  { q: "Fastest land animal?", a: "cheetah" },
  { q: "What is H2O?", a: "water" },
];

const active = new Map();

module.exports = {
  config: {
    name: "quiz",
    aliases: ["trivia"],
    description: "Start a quick trivia quiz",
    usage: "quiz",
    adminOnly: false,
  },
  async run({ api, event, args, threadID, senderID }) {
    if (active.has(threadID)) {
      return api.sendMessage("❓ A quiz is already running in this thread!", threadID);
    }

    const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    active.set(threadID, { answer: q.a, senderID });

    api.sendMessage(`🎯 Quiz Time!\n\n❓ ${q.q}\n\nType your answer now! (30 seconds)`, threadID);

    const timeout = setTimeout(() => {
      if (active.has(threadID)) {
        active.delete(threadID);
        api.sendMessage(`⌛ Time's up! The answer was: ${q.a}`, threadID);
      }
    }, 30000);

    // Listen for answer in next message event
    const checkAnswer = (err, evt) => {
      if (evt.type !== "message" || evt.threadID !== threadID) return;
      const data = active.get(threadID);
      if (!data) return;

      if (evt.body && evt.body.toLowerCase().trim() === data.answer) {
        clearTimeout(timeout);
        active.delete(threadID);
        api.sendMessage(`✅ Correct, ${evt.senderID}! The answer was: ${q.a} 🎉`, threadID);
      }
    };

    // We rely on the main listener but store state in active map
  },
};
