import superjson from "superjson"

const obj = {
	foo: "bar",
	qux: new Uint8Array([1, 2, 3])
}

const serialized = superjson.stringify(obj)

console.log(serialized)
