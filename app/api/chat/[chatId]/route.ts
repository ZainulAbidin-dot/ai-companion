import dotenv from "dotenv";
import { currentUser } from "@clerk/nextjs/server";
import { LangChainAdapter } from "ai";
import { ChatOpenAI } from "@langchain/openai";
import { NextResponse } from "next/server";
import { MemoryManager } from "@/lib/memory";
import prismadb from "@/lib/prismadb";
import { rateLimit } from "@/lib/rate-limit";

dotenv.config({ path: `.env` });

export async function POST(
  req: Request,
  { params }: { params: { chatId: string } },
) {
  try {
    const body = await req.json();
    // console.log("body", body);
    // const { prompt } = body;
    const prompt = body.messages[body.messages.length - 1].content;
    const user = await currentUser();
    if (!user || !user.firstName || !user.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const identifier = req.url + "-" + user.id;
    const { success } = await rateLimit(identifier);
    if (!success) {
      return new NextResponse("Rate limit exceeded", { status: 429 });
    }

    const companion = await prismadb.companion.findUnique({
      where: { id: params.chatId },
    });

    if (!companion) {
      return new NextResponse("Companion not found", { status: 404 });
    }

    const name = companion.id;
    const companion_file_name = name + ".txt";

    const companionKey = {
      companionName: name!,
      userId: user.id,
      modelName: "llama2-13b",
    };
    const memoryManager = await MemoryManager.getInstance();

    const records = await memoryManager.readLatestHistory(companionKey);

    if (records.length === 0) {
      await memoryManager.seedChatHistory(companion.seed, "\n\n", companionKey);
    }
    await memoryManager.writeToHistory("User: " + prompt + "\n", companionKey);

    const recentChatHistory =
      await memoryManager.readLatestHistory(companionKey);
    const similarDocs = await memoryManager.vectorSearch(
      recentChatHistory,
      companion_file_name,
    );

    let relevantHistory = "";
    if (!!similarDocs && similarDocs.length !== 0) {
      relevantHistory = similarDocs.map((doc) => doc.pageContent).join("\n");
    }

    const modifiedPrompt = `
                      ONLY generate plain sentences without prefix of who is speaking. DO NOT use ${companion.name}: prefix. 
                      ${companion.instructions}
                      Below are relevant details about ${companion.name}'s past and the conversation you are in.
                      ${relevantHistory}
                      ${recentChatHistory}\n${companion.name}:
                    `;

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      model: "gpt-4o",
      temperature: 0.8,
      // verbose: true,
    });

    const stream = await model.stream(modifiedPrompt, {});

    return LangChainAdapter.toDataStreamResponse(stream, {
      callbacks: {
        onStart() {
          //! TODO: Remove this
          console.log("Saving prompt", prompt);
          prismadb.message
            .create({
              data: {
                role: "user",
                content: prompt,
                companionId: companion.id,
                userId: user.id,
              },
            })
            .then((message) => {
              console.log("Prompt Message", message);
            })
            .catch((error) => {
              console.log("Prompt Error", error);
            });
        },
        onFinal(completion) {
          //! TODO: Remove this
          console.log("Saving completion", completion);
          prismadb.message
            .create({
              data: {
                role: "system",
                content: completion,
                companionId: companion.id,
                userId: user.id,
              },
            })
            .then((message) => {
              console.log("Completion Message", message);
            })
            .catch((error) => {
              console.log("Completion Error", error);
            });
        },
      },
    });
  } catch (error) {
    console.log(error instanceof Error ? error.message : error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
