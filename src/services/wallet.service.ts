import { prisma } from "../config/db.js";

export const walletService = {
  // Fetch wallet history and stats
  async getWalletHistory(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true },
    });

    if (!user) throw new Error("User not found");

    const transactions = await prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const spent = transactions
      .filter((t: any) => t.type === "debit" && t.status === "Success")
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    const refunds = transactions
      .filter((t: any) => t.type === "credit" && t.title.toLowerCase().includes("refund") && t.status === "Success")
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    return {
      balance: user.walletBalance,
      spent,
      refunds,
      transactions,
    };
  },

  // Securely Add Money (Credit)
  async addMoney(userId: string, amount: number, title: string = "Added to Wallet", description?: string) {
    if (amount <= 0) throw new Error("Amount must be greater than 0");

    return prisma.$transaction(async (tx: any) => {
      // 1. Log the transaction
      const txn = await tx.walletTransaction.create({
        data: {
          userId,
          amount,
          type: "credit",
          title,
          description,
          status: "Success",
        },
      });

      // 2. Increment wallet balance
      await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: {
            increment: amount,
          },
        },
      });

      return txn;
    });
  },

  // Securely Deduct Money (Debit)
  async deductMoney(userId: string, amount: number, title: string, description?: string, referenceId?: string) {
    if (amount <= 0) throw new Error("Amount must be greater than 0");

    return prisma.$transaction(async (tx: any) => {
      // 1. Lock the user row and check balance
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { walletBalance: true },
      });

      if (!user) throw new Error("User not found");
      if (user.walletBalance < amount) throw new Error("Insufficient wallet balance");

      // 2. Log the transaction
      const txn = await tx.walletTransaction.create({
        data: {
          userId,
          amount,
          type: "debit",
          title,
          description,
          status: "Success",
          referenceId,
        },
      });

      // 3. Decrement wallet balance
      await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: {
            decrement: amount,
          },
        },
      });

      return txn;
    });
  },
};
