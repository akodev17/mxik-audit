// The file types a catalogue upload accepts, shared by the drop zone's picker,
// the wizard's check on dropped files and the server action. Browser-safe.

/** .xls stays in so a legacy file reaches the parser and gets its "save as .xlsx" message. */
export const UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

/** The file input's `accept`: the extensions plus their MIME types for pickers that filter by type. */
export const UPLOAD_ACCEPT = [
  ...UPLOAD_EXTENSIONS,
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
].join(',');

/** Whether the file name ends in an accepted extension, ignoring case. */
export function hasUploadExtension(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}
