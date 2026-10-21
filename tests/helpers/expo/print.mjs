// expo-print / expo-sharing stand-ins: invoice HTML is built and inspected, never printed.
export async function printToFileAsync() { return { uri: '/nonexistent-sbx-test/invoice.pdf' }; }
export async function printAsync() {}
export async function shareAsync() {}
export async function isAvailableAsync() { return false; }
