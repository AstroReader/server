# Getting Started with AstroReader's server

## Initial Setup

There is an empty file at `prisma/astroreader.db` \
This is our sqlite3 database \
Initialize the empty database file with
### `npx prisma migrate dev`

## Available Scripts

In the project directory, you can run:

### `yarn start`

Runs a development server with nodemon \
The server will refresh when code is changed \
Open [http://localhost:4000](http://localhost:4000) to view the apollo graphql playground


### `npx prisma migrate dev --name MIGRATION_NAME`
This creates and applies a new migration file in `prisma/migrations/` \
Where `MIGRATION_NAME` is the name of your migration without any spaces

