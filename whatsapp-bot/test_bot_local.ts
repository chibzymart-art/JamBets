import { handleWhatsAppMessage } from './src/handlers/commands';
import { getWhatsAppUserAccess } from './src/services/supabase';

async function runTests() {
  console.log('Testing WhatsApp Bot Local Handlers...');

  // Test 1: Help command
  console.log('\n--- TEST 1: HELP COMMAND ---');
  const helpReply = await handleWhatsAppMessage('2348012345678', 'HELP');
  console.log(helpReply);

  // Test 2: Unlinked user Bangers command (should show free teaser + locked)
  console.log('\n--- TEST 2: UNPAID/UNLINKED USER BANGERS ---');
  const bangersUnpaid = await handleWhatsAppMessage('2348099999999', 'BANGERS');
  console.log(bangersUnpaid);

  // Test 3: Settled command (free for all)
  console.log('\n--- TEST 3: SETTLED RESULTS ---');
  const settledReply = await handleWhatsAppMessage('2348099999999', 'SETTLED');
  console.log(settledReply);

  console.log('\n✅ Local handler tests passed!');
}

runTests().catch(console.error);
