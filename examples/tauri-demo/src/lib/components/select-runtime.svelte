<script lang="ts">
	import { Select } from "@kksh/svelte5"

	const runtimes = [
		{ value: "deno", label: "Deno" },
		{ value: "bun", label: "Bun" },
		{ value: "node", label: "Node" }
	]

	let { value = $bindable("") }: { value: string } = $props()

	const triggerContent = $derived(
		runtimes.find((f) => f.value === value)?.label ?? "Select a runtime"
	)
</script>

<Select.Root type="single" name="favoriteFruit" bind:value>
	<Select.Trigger class="w-[180px]">
		{triggerContent}
	</Select.Trigger>
	<Select.Content>
		<Select.Group>
			<Select.GroupHeading>Runtimes</Select.GroupHeading>
			{#each runtimes as runtime (runtime.value)}
				<Select.Item value={runtime.value} label={runtime.label}>{runtime.label}</Select.Item>
			{/each}
		</Select.Group>
	</Select.Content>
</Select.Root>
