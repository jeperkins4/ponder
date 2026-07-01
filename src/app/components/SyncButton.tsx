"use client";

import { useState } from "react";

interface SyncResponse {
  created: number;
  updated: number;
  error?: string;
}

export default function SyncButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data: SyncResponse = await response.json();

      if (!response.ok) {
        setError(data.error || "Sync failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred during sync");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleSync}
        disabled={isLoading}
        className={`px-6 py-3 rounded-lg font-semibold text-white transition-colors ${
          isLoading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-500 hover:bg-blue-600 active:bg-blue-700"
        }`}
      >
        {isLoading ? "Importing…" : "Import from JIRA"}
      </button>

      {error && (
        <div role="alert" className="text-red-600 font-semibold">
          Error: {error}
        </div>
      )}

      {result && (
        <div className="text-green-600 font-semibold">
          {result.created + result.updated} stories imported ({result.created} created,{" "}
          {result.updated} updated)
        </div>
      )}
    </div>
  );
}
