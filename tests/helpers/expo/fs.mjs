export const documentDirectory = '/nonexistent-sbx-test/';
export async function getInfoAsync() { return { exists: false }; }
export async function deleteAsync() {}
export async function moveAsync() {}
export async function copyAsync() {}
export async function makeDirectoryAsync() {}
export async function readDirectoryAsync() { return []; }
export async function readAsStringAsync() { throw new Error('no file'); }
export async function writeAsStringAsync() {}
