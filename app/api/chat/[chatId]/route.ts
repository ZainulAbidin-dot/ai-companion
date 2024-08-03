import dotenv from 'dotenv';
import { currentUser } from '@clerk/nextjs/server';
import { createStreamDataTransformer, LangChainStream, StreamingTextResponse } from 'ai';
import { ChatOpenAI } from '@langchain/openai'
import { HttpResponseOutputParser } from "langchain/output_parsers";
// import { Replicate } from 'langchain/llms/replicate';
import { NextResponse } from 'next/server';
import { PromptTemplate } from '@langchain/core/prompts'
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

    const TEMPLATE = `
                      ONLY generate plain sentences without prefix of who is speaking. DO NOT use ${companion.name}: prefix. 
                      ${companion.instructions}
                      Below are relevant details about ${companion.name}'s past and the conversation you are in.
                      ${relevantHistory}
                      ${recentChatHistory}\n${companion.name}:
                    `;
    const modifiedPrompt = PromptTemplate.fromTemplate(TEMPLATE)

    const model = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'gpt-3.5-turbo',
        temperature: 0.8,
        verbose: true,
    });

    const parser = new HttpResponseOutputParser();

    const chain = modifiedPrompt.pipe(model.bind({ stop: ["?"] })).pipe(parser);
    const stream = await chain.stream({ 
        chat_history: recentChatHistory,
        input: prompt
     });

    const response = new StreamingTextResponse(stream.pipeThrough(createStreamDataTransformer()),)

    console.log(response)

    // await memoryManager.writeToHistory('' + response, companionKey);
    // var Readable = require('stream').Readable;

    // let s = new Readable();
    // s.push(response);
    // s.push(null);
    // if (response !== undefined && response) {
    //   memoryManager.writeToHistory('' + response, companionKey);

    //   await prismadb.companion.update({
    //     where: {
    //       id: params.chatId,
    //     },
    //     data: {
    //       messages: {
    //         create: {
    //           content: response != null ? response.body : "sd",
    //           role: 'system',
    //           userId: user.id,
    //         },
    //       },
    //     },
    //   });
    // }

    return response;
  } catch (error) {
    return new NextResponse('Internal Error', { status: 500 });
  }
}