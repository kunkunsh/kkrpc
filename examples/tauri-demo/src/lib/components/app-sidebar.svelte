<script lang="ts">
	import { Sidebar } from "@kksh/svelte5"
	import { CalculatorIcon, DatabaseIcon, HomeIcon, SquareTerminalIcon } from "@lucide/svelte"

	const items = [
		{
			title: "Home",
			url: "/",
			icon: HomeIcon
		},
		{
			title: "Editor",
			url: "/examples/editor",
			icon: SquareTerminalIcon
		},
		{
			title: "Math",
			url: "/examples/math",
			icon: CalculatorIcon
		},
		{
			title: "Database",
			url: "/examples/database",
			icon: DatabaseIcon
		}
	]
</script>

<Sidebar.Root>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>kkrpc Tauri Examples</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each items as item (item.title)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton>
								{#snippet child({ props })}
									<a href={item.url} {...props}>
										<item.icon />
										<span>{item.title}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
