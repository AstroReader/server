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
  }

  type Subscription {
    runningTasks: [Task!]
  }
`;

const resolvers: Config["resolvers"] = {
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
