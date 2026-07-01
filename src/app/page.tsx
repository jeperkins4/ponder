import SyncButton from "@/app/components/SyncButton";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">JIRA Kanban Sync</h1>
      <p className="text-xl text-gray-600 mb-8">v1 - Local sync only</p>
      <SyncButton />
    </main>
  );
}
