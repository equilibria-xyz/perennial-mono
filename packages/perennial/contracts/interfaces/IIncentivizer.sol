// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "@equilibria/root/token/types/Token18.sol";
import "@equilibria/root/number/types/UFixed18.sol";
import "@equilibria/perennial-oracle/contracts/interfaces/IOracleProvider.sol";
import "./types/ProgramInfo.sol";
import "./IController.sol";
import "./IProduct.sol";

interface IIncentivizer {
    event ProgramCreated(IProduct indexed product, uint256 indexed programId, ProgramInfo programInfo, UFixed18 programFeeAmount);
    event ProgramStarted(IProduct indexed product, uint256 indexed programId, uint256 version);
    event ProgramComplete(IProduct indexed product, uint256 indexed programId, uint256 version);
    event Claim(IProduct indexed product, address indexed account, uint256 indexed programId, UFixed18 amount);
    event FeeClaim(Token18 indexed token, UFixed18 amount);

    error IncentivizerNotAllowedError(IProduct product);
    error IncentivizerTooManyProgramsError();
    error IncentivizerNotProgramOwnerError(IProduct product, uint256 programId);
    error IncentivizerInvalidProgramError(IProduct product, uint256 programId);
    error IncentivizerBatchClaimArgumentMismatchError();

    function programInfos(IProduct product, uint256 programId) external view returns (ProgramInfo memory);
    function fees(Token18 token) external view returns (UFixed18);
    function initialize(IController controller_) external;
    function create(IProduct product, ProgramInfo calldata info) external returns (uint256);
    function complete(IProduct product, uint256 programId) external;
    function sync(IOracleProvider.OracleVersion memory currentOracleVersion) external;
    function syncAccount(address account, IOracleProvider.OracleVersion memory currentOracleVersion) external;
    function claim(IProduct product, uint256[] calldata programIds) external;
    function claimFor(address account, IProduct product, uint256[] calldata programIds) external;
    function claim(IProduct[] calldata products, uint256[][] calldata programIds) external;
    function claimFee(Token18[] calldata tokens) external;
    function active(IProduct product) external view returns (uint256);
    function count(IProduct product) external view returns (uint256);
    function unclaimed(IProduct product, address account, uint256 programId) external view returns (UFixed18);
    function available(IProduct product, uint256 programId) external view returns (UFixed18);
    function versionStarted(IProduct product, uint256 programId) external view returns (uint256);
    function versionComplete(IProduct product, uint256 programId) external view returns (uint256);
    function owner(IProduct product, uint256 programId) external view returns (address);
    function treasury(IProduct product, uint256 programId) external view returns (address);
    function treasury(uint256 coordinatorId) external view returns (address);
}
