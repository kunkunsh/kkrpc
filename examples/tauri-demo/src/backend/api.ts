export class Api {
	eval(code: string) {
		return eval(code)
	}
}

export const api = new Api()
