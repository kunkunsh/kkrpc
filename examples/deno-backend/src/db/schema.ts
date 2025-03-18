import { int, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const todosTable = sqliteTable("todos_table", {
	id: int().primaryKey({ autoIncrement: true }),
	title: text().notNull(),
	completed: int().notNull().default(0)
})
