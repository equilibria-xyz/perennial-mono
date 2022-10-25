import { expect } from 'chai'
import HRE from 'hardhat'
import { constants, utils } from 'ethers'
import { Deployment } from 'hardhat-deploy/types'
import {
  Collateral,
  Collateral__factory,
  Controller,
  Controller__factory,
  Incentivizer,
  Incentivizer__factory,
} from '../../../types/generated'
import { getMultisigAddress } from '../../../../common/testutil/constants'

const { ethers } = HRE

describe('Mainnet Verification', () => {
  let deployments: { [name: string]: Deployment }
  let controller: Controller
  let collateral: Collateral
  let incentivizer: Incentivizer

  beforeEach(async () => {
    const [signer] = await ethers.getSigners()
    deployments = await HRE.deployments.all()
    controller = Controller__factory.connect(deployments['Controller_Proxy'].address, signer)
    collateral = Collateral__factory.connect(deployments['Collateral_Proxy'].address, signer)
    incentivizer = Incentivizer__factory.connect(deployments['Incentivizer_Proxy'].address, signer)
  })

  describe('controller', () => {
    it('has the correct parameters and configuration', async () => {
      const timelockAddress = '0xA20ea565cD799e01A86548af5a2929EB7c767fC9' // deployments['TimelockController'].address

      expect(await controller.collateral()).to.equal(collateral.address)
      expect(await controller.incentivizer()).to.equal(incentivizer.address)
      expect(await controller.productBeacon()).to.equal(deployments['UpgradeableBeacon'].address)

      expect(await controller['owner()']()).to.equal(timelockAddress)
      expect(await controller['treasury()']()).to.equal(timelockAddress)
      expect(await controller['pendingOwner()']()).to.equal(constants.AddressZero)

      expect(await controller.protocolFee()).to.equal(0)
      expect(await controller.minFundingFee()).to.equal(0)
      expect(await controller.liquidationFee()).to.equal(0 /* utils.parseEther('0.10') */)
      expect(await controller.incentivizationFee()).to.equal(0)
      expect(await controller.minCollateral()).to.equal(0 /* utils.parseEther('2500') */)
      expect(await controller.programsPerProduct()).to.equal(0)

      expect(await controller.pauser()).to.equal(
        '0xA20ea565cD799e01A86548af5a2929EB7c767fC9' /* getMultisigAddress('mainnet') */,
      )
      expect(await controller.paused()).to.be.false
    })
  })

  describe('collateral', () => {
    it('has the correct configuration', async () => {
      expect(await collateral.controller()).to.equal(controller.address)
      expect(await collateral.token()).to.equal(deployments['DSU'].address)
    })
  })

  describe('incentivizer', () => {
    it('has the correct configuration', async () => {
      expect(await incentivizer.controller()).to.equal(controller.address)
    })
  })
})
