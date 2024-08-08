"use client";

import { Companion } from "@prisma/client";
import { FC, useState } from "react";
import { useChat, type Message } from "ai/react";

import { ChatHeader } from "@/components/chat-header";
import { ChatForm } from "@/components/chat-form";
import { ChatMessages } from "@/components/chat-messages";

interface ChatClientProps {
  companion: Companion & {
    messages: Pick<Message, "id" | "role" | "content">[];
    _count: {
      messages: number;
    };
  };
}

const ChatClient: FC<ChatClientProps> = ({ companion }) => {
  const [streaming, setStreaming] = useState<boolean>(false);
  const {
    input,
    isLoading,
    handleInputChange,
    handleSubmit,
    messages,
    setMessages,
  } = useChat({
    api: `/api/chat/${companion.id}`,
    initialMessages: companion.messages,
    onFinish(message) {
      console.log("onFinish", message);
      // we are using user and system messages to communicate with the bot.
      //? Why we are using the role of system for assistant messages?
      setStreaming(false);
      setMessages((currentMessages) => {
        const messagesExceptLast = currentMessages.slice(0, -1);
        return [
          ...messagesExceptLast,
          {
            id: message.id,
            role: "system",
            content: message.content,
          },
        ];
      });
    },
    onResponse(response) {
      console.log("onResponse", response);
      setStreaming(true);
    },
  });

  return (
    <div className="flex h-full flex-col space-y-2 p-4">
      <ChatHeader companion={companion} />
      <ChatMessages
        companion={companion}
        isLoading={isLoading && !streaming}
        messages={messages}
      />
      <ChatForm
        isLoading={isLoading}
        input={input}
        handleInputChange={handleInputChange}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export { ChatClient };
