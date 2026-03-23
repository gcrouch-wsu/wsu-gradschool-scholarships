import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AssignProgramForm } from "./AssignProgramForm";
import { CreateConnectionForm } from "./CreateConnectionForm";
import { DeleteConnectionButton } from "./DeleteConnectionButton";
import { RotateButton } from "./RotateButton";
import { TestButton } from "./TestButton";

export default async function ConnectionsPage() {
  const user = await getSessionUser();
  if (!user?.is_platform_admin) {
    return (
      <div className="text-zinc-600">
        You do not have permission to manage connections.
      </div>
    );
  }

  const { rows: connections } = await query<{
    id: string;
    name: string;
    provider: string;
    status: string;
    program_id: string | null;
    last_verified_at: string | null;
    rotated_at: string | null;
  }>(
    "SELECT id, name, provider, status, program_id, last_verified_at, rotated_at FROM connections ORDER BY name"
  );

  const { rows: programs } = await query<{ id: string; name: string }>(
    "SELECT id, name FROM scholarship_programs WHERE status = 'active' ORDER BY name"
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">
        Smartsheet connections
      </h1>
      <p className="mb-4 text-sm text-zinc-600">
        Platform admins can add Smartsheet API connections. Assign each connection to a program so scholarship admins can use it for their cycles. Unassigned connections are platform-only.
      </p>

      <CreateConnectionForm programs={programs} />

      <div className="mt-8 space-y-3">
        {connections.length === 0 ? (
          <p className="text-sm text-zinc-500">No connections yet.</p>
        ) : (
          connections.map((c) => (
            <div
              key={c.id}
              className="grid gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-900">{c.name}</span>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {c.provider}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      c.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {c.last_verified_at && (
                    <span>
                      Verified {new Date(c.last_verified_at).toLocaleDateString()}
                    </span>
                  )}
                  {c.rotated_at && (
                    <span>
                      Rotated {new Date(c.rotated_at).toLocaleDateString()}
                    </span>
                  )}
                  {!c.program_id && <span>Platform-only</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <AssignProgramForm
                  connectionId={c.id}
                  connectionName={c.name}
                  currentProgramId={c.program_id}
                  programs={programs}
                />
                <TestButton connectionId={c.id} />
                <RotateButton connectionId={c.id} connectionName={c.name} />
                <DeleteConnectionButton connectionId={c.id} connectionName={c.name} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
