import { constants, utils, BigNumberish } from 'ethers'
import { IMultiInvoker } from '../types/generated/contracts/interfaces/IMultiInvoker'

export type InvokerAction =
  | 'NOOP'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'OPEN_TAKE'
  | 'CLOSE_TAKE'
  | 'OPEN_MAKE'
  | 'CLOSE_MAKE'
  | 'CLAIM'
  | 'WRAP'
  | 'UNWRAP'
  | 'WRAP_AND_DEPOSIT'
  | 'WITHDRAW_AND_UNWRAP'
  | 'VAULT_DEPOSIT'
  | 'VAULT_REDEEM'
  | 'VAULT_CLAIM'
  | 'VAULT_WRAP_AND_DEPOSIT'

export const buildInvokerActions = ({
  userAddress,
  productAddress,
  position,
  amount,
  programs,
  vaultAddress = constants.AddressZero,
  vaultAmount = 0,
}: {
  userAddress: string
  productAddress: string
  position: BigNumberish
  amount: BigNumberish
  programs: number[]
  vaultAddress?: string
  vaultAmount?: BigNumberish
}): { [action in InvokerAction]: IMultiInvoker.InvocationStruct } => {
  return {
    NOOP: {
      action: 0,
      args: '0x',
    },
    DEPOSIT: {
      action: 1,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    WITHDRAW: {
      action: 2,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    OPEN_TAKE: {
      action: 3,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLOSE_TAKE: {
      action: 4,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    OPEN_MAKE: {
      action: 5,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLOSE_MAKE: {
      action: 6,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLAIM: {
      action: 7,
      args: utils.defaultAbiCoder.encode(['address', 'uint[]'], [productAddress, programs]),
    },
    WRAP: {
      action: 8,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    UNWRAP: {
      action: 9,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    WRAP_AND_DEPOSIT: {
      action: 10,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    WITHDRAW_AND_UNWRAP: {
      action: 11,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    VAULT_DEPOSIT: {
      action: 12,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, vaultAddress, vaultAmount]),
    },
    VAULT_REDEEM: {
      action: 13,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [vaultAddress, vaultAmount]),
    },
    VAULT_CLAIM: {
      action: 14,
      args: utils.defaultAbiCoder.encode(['address', 'address'], [userAddress, vaultAddress]),
    },
    VAULT_WRAP_AND_DEPOSIT: {
      action: 15,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, vaultAddress, vaultAmount]),
    },
  }
}
