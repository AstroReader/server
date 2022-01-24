import {makeExecutableSchema} from "@graphql-tools/schema";
import {PrismaClient} from "@prisma/client";
import {ApolloServerPluginDrainHttpServer} from "apollo-server-core";
import {ApolloServer, Config, gql} from "apollo-server-express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import {DocumentNode, execute, subscribe} from "graphql";
import {PubSub} from "graphql-subscriptions";
import http from "http";
import jwt from "jsonwebtoken";
import path from "path";
import {SubscriptionServer} from "subscriptions-transport-ws";

const LOWERCASE_ALPHABET = "abcdefghijklmnopqrstuvwxyz"; // 26 chars
const UPPERCASE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
const NUMBERS = "0123456789"; // 10 chars
const SYMBOLS = ",./<>?;'\":[]\\|}{=-_+`~!@#$%^&*()"; // 32 chars
const ALPHANUMERIC_CHARS = LOWERCASE_ALPHABET + UPPERCASE_ALPHABET + NUMBERS; // 62 chars
const ALL_CHARS = ALPHANUMERIC_CHARS + SYMBOLS; // 94 chars

const saltRounds = 10;
const JWT_PRIVATE_KEY = "supersecretprivatekey";

const generateRandomPassword = (length: number, alphabet: string) => {
  let rb = crypto.randomBytes(length);
  let rp = "";

  for (var i = 0; i < length; i++) {
    rb[i] = rb[i] % alphabet.length;
    rp += alphabet[rb[i]];
  }

  return rp;
};

const prisma = new PrismaClient();

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
    context: ({ req }) => {
      const token = req.headers.authorization || "";

      return { user: token };
    },
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
    token: String
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
    createUser(username: String!, password: String!): User!
    loginUser(username: String!, password: String!): User
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
    createUser: async (_parent, args, _ctx, _info) => {
      const { username, password } = args;
      try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const user = await prisma.user.create({
          data: {
            username,
            password: hashedPassword,
          },
        });

        const token = jwt.sign({ id: user.id }, JWT_PRIVATE_KEY, {
          expiresIn: "7d",
        });

        const userWithToken = { ...user, token };
        return userWithToken;
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    },
    loginUser: async (_parent, args, _ctx, _info) => {
      const { username, password } = args;
      const user = await prisma.user.findUnique({ where: { username } });

      if (user === null) {
        return null;
      }

      const passwordMatch = await bcrypt.compare(password, user.password);

      if (passwordMatch === false) {
        return null;
      }

      const token = jwt.sign({ id: user.id }, JWT_PRIVATE_KEY, {
        expiresIn: "7d",
      });

      return { ...user, token };
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
