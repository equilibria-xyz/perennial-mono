import { utils, BigNumberish } from 'ethers'
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

export const buildInvokerActions = (
  userAddress: string,
  productAddress: string,
  position: BigNumberish,
  amount: BigNumberish,
  programs: number[],
): { [action in InvokerAction]: IMultiInvoker.InvocationStruct } => {
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
  }
}
