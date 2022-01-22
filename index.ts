import fs from "fs";
import path from "path";
import { ApolloServer, gql, Config } from "apollo-server-express";
import { ApolloServerPluginDrainHttpServer } from "apollo-server-core";
import express from "express";
import http from "http";
import { DocumentNode, execute, subscribe } from "graphql";
import { SubscriptionServer } from "subscriptions-transport-ws";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { PubSub } from "graphql-subscriptions";

const pubsub = new PubSub();

const backgroundTasks: { name: string; message?: string }[] = [];

async function startApolloServer(typeDefs: DocumentNode, resolvers: any) {
  const app = express();
  const httpServer = http.createServer(app);

  app.get("/test", (_, res) => {
    res.send("hello world");
  });
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const subscriptionServer = SubscriptionServer.create(
    {
      schema,
      execute,
      subscribe,
    },
    {
      server: httpServer,
      path: "/graphql",
    }
  );

  const server = new ApolloServer({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              subscriptionServer.close();
            },
          };
        },
      },
    ],
  });

  await server.start();

  server.applyMiddleware({
    app,
    path: "/",
  });

  await new Promise<void>((resolve) =>
    httpServer.listen({ port: 4000 }, resolve)
  );

  console.log(`🚀 Server ready at http://localhost:4000${server.graphqlPath}`);
}

const typeDefs = gql`
  enum StatusCode {
    SUCCESS
    ERROR
  }
  type User {
    id: Int!
    username: String!
    password: String!
  }

  type Task {
    name: String!
    message: String
  }

  type Query {
    users: [User!]
  }

  type Mutation {
    createTask(name: String!, message: String): Task!
    scan(folderPath: String!): StatusCode!
  }

  type Subscription {
    runningTasks: [Task!]
  }
`;

const StatusCode = {
  SUCCESS: 200,
  ERROR: 500,
};

const resolvers: Config["resolvers"] = {
  StatusCode,
  Query: {
    users: () => [{ id: 1, username: "john", password: "123" }],
  },
  Mutation: {
    createTask: (_parent, args, _ctx, _info) => {
      const { name, message } = args;
      const task = { name, message };
      backgroundTasks.push(task);
      console.log(backgroundTasks);
      pubsub.publish("CREATE_TASK", { runningTasks: backgroundTasks });
      return task;
    },
    scan: (_parent, args, _ctx, _info) => {
      const { folderPath } = args;
      // const result = {}
      let test = fs.readdirSync(folderPath);

      test = test.map((file) => {
        return path.join(folderPath, file);
      });

      console.log(test);
      return StatusCode.SUCCESS;
    },
  },
  Subscription: {
    runningTasks: {
      subscribe: () => {
        return pubsub.asyncIterator(["CREATE_TASK"]);
      },
    },
  },
};

startApolloServer(typeDefs, resolvers);

const scan = (rootPath: string) => {
  try {
    const ls = fs.readdirSync(rootPath);

    ls.forEach((entry) => {
      const entryPath = path.join(rootPath, entry);
      const entryIsDirectory = fs.statSync(entryPath).isDirectory();

      if (entryIsDirectory === false) {
        console.log(path.basename(path.dirname(entryPath)));
      }
    });
  } catch (err) {
    console.log(err);
  }
};
