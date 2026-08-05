// Object-storage folder prefixes.
//
// Uploads used to land in the bucket root as bare UUIDs, which made it
// impossible to tell an identity document from a car photo, or to apply a
// retention/access policy to sensitive scans. Keys are now `<folder>/<uuid>`.
//
// This list is the single source of truth and is mirrored in each client's
// photoUrl() helper — a folder added here must be added there too, or the
// clients will strip the prefix and the proxy will 404.
//
// The folder is chosen at UPLOAD time and is part of the key stored on the
// row. Objects are never moved between folders afterwards: the key is a
// foreign reference held in the database (and in already-issued URLs), so
// relocating an object on verification would break every existing link.
const STORAGE_FOLDERS = [
  'kyc',        // Aadhaar / e-KYC document scans
  'pan',        // PAN cards
  'license',    // Driving licences (front and back)
  'vehicle-rc', // Vehicle registration certificates
  'vehicle',    // Car listing photos
  'profile',    // Profile pictures
  'ride',       // Start/end ride photos (odometer, fuel, damage)
  'misc',       // Anything that doesn't declare a folder
];

const DEFAULT_FOLDER = 'misc';

const isValidFolder = (folder) => STORAGE_FOLDERS.includes(folder);

// Falls back to `misc` rather than throwing: an old client that doesn't send a
// folder must keep working, it just doesn't get the benefit of sorting.
const normaliseFolder = (folder) => (isValidFolder(folder) ? folder : DEFAULT_FOLDER);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FOLDER_RE = new RegExp(`(?:^|/)(${STORAGE_FOLDERS.join('|')})/(${UUID_RE.source})`, 'i');

// Pulls the storage key out of a URL or path.
//
// Returns `<folder>/<uuid>` when the path carries a known folder, otherwise the
// bare trailing UUID. Both forms must keep working: every object uploaded
// before folders existed still has a bare-UUID key, and those rows were not
// migrated.
const extractKey = (path) => {
  const clean = String(path || '').replace(/^\/+/, '').split('?')[0];

  const foldered = clean.match(FOLDER_RE);
  if (foldered) return `${foldered[1].toLowerCase()}/${foldered[2]}`;

  const uuids = clean.match(new RegExp(UUID_RE.source, 'gi'));
  return uuids ? uuids[uuids.length - 1] : clean;
};

module.exports = { STORAGE_FOLDERS, DEFAULT_FOLDER, isValidFolder, normaliseFolder, extractKey };
