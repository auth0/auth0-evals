import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

fastify.get('/', async (request, reply) => {
  return { message: 'Barkbook API' };
});

const port = process.env.PORT;
await fastify.listen({ port });
