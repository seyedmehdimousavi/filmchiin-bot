import botWorker from "../bot.js";

export default {
  async fetch(request, env, ctx) {
    return botWorker.fetch(request, env, ctx);
  },
};