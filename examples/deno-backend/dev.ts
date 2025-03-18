import { drizzle } from "drizzle-orm/better-sqlite3"
import { todosTable } from "./src/db/schema.ts"

const db = drizzle("sqlite.db")
const result = await db.select().from(todosTable)
console.log(result)

// import { eq } from "drizzle-orm"
// import { drizzle } from "drizzle-orm/libsql"
// import { todosTable } from "./src/db/schema.ts"

// const db = drizzle({
// 	url: "sqlite.db"
// })

// const user: typeof todosTable.$inferInsert = {
// 	title: "John",
// 	completed: 0
// }

// await db.insert(todosTable).values(user)
// console.log("New user created!")

// const todos = await db.select().from(todosTable)
// console.log("Getting all todos from the database: ", todos)
// await db
// 	.update(todosTable)
// 	.set({
// 		completed: 1
// 	})
// 	.where(eq(todosTable.id, todos[0].id))
// console.log("Todo info updated!")

// await db.delete(todosTable).where(eq(todosTable.id, todos[0].id))
// console.log("Todo deleted!")
