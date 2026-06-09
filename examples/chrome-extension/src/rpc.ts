export interface BackgroundAPI {
	ping(source: string): Promise<string>
}

export interface ContentAPI {
	getPageTitle(): Promise<string>
}
