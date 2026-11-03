const GENDERS = ["Female", "Male", "Other"];

/** Gender + department inputs for a captain, so the W and T squad checks count them. */
export function CaptainFactsFields({
  departments,
  gender = "",
  department = "",
  required = false,
  listId,
}: {
  departments: string[];
  gender?: string;
  department?: string;
  required?: boolean;
  listId: string;
}) {
  const knownGender = GENDERS.find((item) => item.toLowerCase() === gender.trim().toLowerCase());
  return (
    <>
      <label className="block">
        <span className="text-sm">Captain gender</span>
        <select
          name="captainGender"
          defaultValue={knownGender ?? gender}
          required={required}
          className="field"
        >
          <option value="">Choose…</option>
          {knownGender || !gender ? null : <option value={gender}>{gender}</option>}
          {GENDERS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Captain department</span>
        <input
          name="captainDepartment"
          defaultValue={department}
          required={required}
          list={listId}
          placeholder="Sales"
          autoComplete="off"
          className="field min-w-48"
        />
        <datalist id={listId}>
          {departments.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
    </>
  );
}
