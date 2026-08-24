export default {
  async fetch(request, env, ctx) {
    return new Response('chordbloom-credits', {status: 200});
  }
};
