import Fastify from 'fastify';
const app = Fastify();
app.get('/:type/*', async (request, reply) => {
  const query = request.params['*'];
  return { query };
});
app.listen({ port: 3000 }, async () => {
  const res = await fetch('http://127.0.0.1:3000/parcel/https%3A%2F%2Fwww.amazon.de%2F');
  console.log(await res.json());
  process.exit(0);
});
