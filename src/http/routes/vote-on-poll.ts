import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import z from "zod";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { voting } from "../../utils/voting-pub-sub";

export async function voteOnPoll(app: FastifyInstance) {
  app.post("/polls/:pollId/votes", async (request, reply) => {
    const voteOnPollParams = z.object({
      pollId: z.string().uuid(),
    });

    const voteOnPollBody = z.object({
      pollOptionId: z.string().uuid(),
    });

    const { pollId } = voteOnPollParams.parse(request.params);
    const { pollOptionId } = voteOnPollBody.parse(request.body);

    let { sessionId } = request.cookies;

    if (!sessionId) {
      sessionId = randomUUID();

      reply.setCookie("sessionId", sessionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true,
        httpOnly: true,
      });
    }

    const existingVote = await prisma.vote.findUnique({
      where: {
        sessionId_pollId: {
          sessionId,
          pollId,
        },
      },
    });

    if (existingVote && existingVote.pollOptionId !== pollOptionId) {
      await prisma.vote.delete({
        where: {
          id: existingVote.id,
        },
      });

      const votes = await redis.zincrby(pollId, -1, existingVote.pollOptionId);

      voting.publish(pollId, {
        pollOptionId: existingVote.pollOptionId,
        votes: Number(votes),
      });
    } else if (existingVote) {
      return reply.status(400).send({
        message: "You have already voted on this poll",
      });
    }

    await prisma.vote.create({
      data: {
        sessionId,
        pollId,
        pollOptionId,
      },
    });

    const votes = await redis.zincrby(pollId, 1, pollOptionId);

    voting.publish(pollId, {
      pollOptionId,
      votes: Number(votes),
    });

    return reply.status(201).send();
  });
}
