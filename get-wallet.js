// Quick script to get wallet info
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ quiet: true });

const prisma = new PrismaClient();

async function main() {
  const userId = process.argv[2];
  
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: { accounts: true }
  });
  
  if (wallet) {
    console.log(JSON.stringify(wallet, null, 2));
  } else {
    console.log('NO_WALLET_FOUND');
  }
}

main()
  .finally(() => prisma.$disconnect());
