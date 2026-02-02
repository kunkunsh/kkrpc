// Echo worker for relay tests
const { stdin, stdout } = process

stdin.on("data", (data) => {
	const message = data.toString()
	stdout.write(message)
})

stdin.on("end", () => {
	process.exit(0)
})
