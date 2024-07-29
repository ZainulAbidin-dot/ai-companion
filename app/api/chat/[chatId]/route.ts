import dotenv from 'dotenv';
import { currentUser } from '@clerk/nextjs/server';
import { LangChainStream, StreamingTextResponse } from 'ai';
import Replicate from 'replicate';
import { NextResponse } from 'next/server';

import { MemoryManager } from '@/lib/memory';
import prismadb from '@/lib/prismadb';
import { rateLimit } from '@/lib/rate-limit';

dotenv.config({ path: `.env` });

export async function POST(
  req: Request,
  { params }: { params: { chatId: string } }
) {
  try {
    const { prompt } = await req.json();
    const user = await currentUser();
    if (!user || !user.firstName || !user.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const identifier = req.url + '-' + user.id;
    const { success } = await rateLimit(identifier);
    if (!success) {
      return new NextResponse('Rate limit exceeded', { status: 429 });
    }

    const companion = await prismadb.companion.update({
      where: {
        id: params.chatId,
      },
      data: {
        messages: {
          create: {
            content: prompt,
            role: 'user',
            userId: user.id,
          },
        },
      },
    });

    if (!companion) {
      return new NextResponse('Companion not found', { status: 404 });
    }

    const name = companion.id;
    const companion_file_name = name + '.txt';

    const companionKey = {
      companionName: name!,
      userId: user.id,
      modelName: 'llama2-13b',
    };
    const memoryManager = await MemoryManager.getInstance();
    const records = await memoryManager.readLatestHistory(companionKey);
    if (records.length === 0) {
      await memoryManager.seedChatHistory(companion.seed, '\n\n', companionKey);
    }
    await memoryManager.writeToHistory('User: ' + prompt + '\n', companionKey);

    const recentChatHistory = await memoryManager.readLatestHistory(
      companionKey
    );
    const similarDocs = await memoryManager.vectorSearch(
      recentChatHistory,
      companion_file_name
    );

    let relevantHistory = '';
    if (!!similarDocs && similarDocs.length !== 0) {
      relevantHistory = similarDocs.map((doc) => doc.pageContent).join('\n');
    }

    const { handlers } = LangChainStream();
    const model = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN
    });

    const prediction = await model
        .run(
                "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",            {
                input: {
                    prompt: `ONLY generate plain sentences without prefix of who is speaking. DO NOT use ${companion.name}: prefix.
                    ${companion.instructions}
                    Below are relevant details about ${companion.name}'s past and the conversation you are in.
                    ${relevantHistory}
                    ${recentChatHistory}\n${companion.name}:`      
                }
            }
        );

    console.log("MODEL OUTPUT: ", prediction)
    const resp = prediction;
    
    // const cleaned = resp.replaceAll(',', '');
    // const chunks = cleaned.split('\n');
    // const response = chunks[0];
    const response = resp;

    await memoryManager.writeToHistory('' + response, companionKey);
    // var Readable = require('stream').Readable;

    // let s = new Readable();
    // s.push(response);
    // s.push(null);
    if (response !== undefined && response) {
      memoryManager.writeToHistory('' + response, companionKey);

    //   await prismadb.companion.update({
    //     where: {
    //       id: params.chatId,
    //     },
    //     data: {
    //       messages: {
    //         create: {
    //           content: response,
    //           role: 'system',
    //           userId: user.id,
    //         },
    //       },
    //     },
    //   });
    }

    console.log(response)
    return new NextResponse("HI");
  } catch (error) {
    console.log(error)
    return new NextResponse('Internal Error', { status: 500 });
  }
}