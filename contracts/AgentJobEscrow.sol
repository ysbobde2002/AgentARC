// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title AgentJobEscrow
/// @notice Authorize → capture | void for agent-to-agent jobs on Arc.
///         USDC sits in the contract until the operator captures (seller paid)
///         or voids (buyer restored). Capture is final — not a chargeback.
contract AgentJobEscrow {
    IERC20 public immutable usdc;
    address public operator;

    enum Status {
        None,
        Authorized,
        Captured,
        Voided
    }

    struct Job {
        address buyer;
        address seller;
        uint256 amount;
        Status status;
    }

    mapping(bytes32 => Job) public jobs;

    event Authorized(bytes32 indexed jobId, address buyer, address seller, uint256 amount);
    event Captured(bytes32 indexed jobId, address seller, uint256 amount);
    event Voided(bytes32 indexed jobId, address buyer, uint256 amount);

    error Unauthorized();
    error BadStatus();
    error TransferFailed();

    constructor(address usdc_, address operator_) {
        usdc = IERC20(usdc_);
        operator = operator_;
    }

    function authorize(bytes32 jobId, address buyer, address seller, uint256 amount) external {
        if (msg.sender != operator && msg.sender != buyer) revert Unauthorized();
        if (jobs[jobId].status != Status.None) revert BadStatus();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        jobs[jobId] = Job(buyer, seller, amount, Status.Authorized);
        emit Authorized(jobId, buyer, seller, amount);
    }

    function capture(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != operator) revert Unauthorized();
        if (job.status != Status.Authorized) revert BadStatus();
        job.status = Status.Captured;
        if (!usdc.transfer(job.seller, job.amount)) revert TransferFailed();
        emit Captured(jobId, job.seller, job.amount);
    }

    function voidJob(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != operator) revert Unauthorized();
        if (job.status != Status.Authorized) revert BadStatus();
        job.status = Status.Voided;
        if (!usdc.transfer(job.buyer, job.amount)) revert TransferFailed();
        emit Voided(jobId, job.buyer, job.amount);
    }
}
