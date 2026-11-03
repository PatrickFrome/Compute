# Exact source baseline

This incremental patch expects Git tree
`7aa8184e89a4ca3754275e81bf3f83a61276837b`, the verified #1445 result.
The parent's local commit1103decb could not be fetched and is not asserted equal.

Reconstruct the baseline in an isolated directory using only these existing
source artifacts; do not apply the original e6-to-c265 patches to this snapshot:

1. Obtain [source transfer commit accb28e7](https://github.com/PatrickFrome/Compute/tree/accb28e72c87c059e780efb8e6681886b33e9b4f/coordination/source-transfer/c26565e).
   Concatenate archive.part00, archive.part01, archive.part02 in that order.
   The ZIP SHA256 must be
   `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
   Extract the source; its tree must be
   `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
2. Apply the [cumulative #1438 patch](https://github.com/PatrickFrome/Compute/blob/303cf2260152b221dd71652aa674a1fcee4a780c/coordination/source-deliverables/protected-backup-root-c26565e-20261103/protected-backup-root-provider.patch).
   SHA256 `9889999dfe35be42cd8d3b6d5d4fa3e3ce56a51bd321ec7bd0f9329d89c7b54e`;
   result tree `cf8cbe232fef42c5ebf6c76316544e9e1cbe743b`.
   Do not additionally apply its two historical incremental patches.
3. Apply [#1443 original-directory-custody.patch](https://github.com/PatrickFrome/Compute/blob/f58fa33bec83a8a73b57532b274ef11c391b6975/coordination/source-deliverables/native-directory-custody-cf8cbe2-20261103/original-directory-custody.patch).
   SHA256 `5567ec3d20da83cb260426f6b9ed32599e60a6b0184d535f8bac591859631bdd`;
   result tree `23e4cd10df4817505f8dc3e276cc7688753992e3`.
4. Apply [#1445 installed-recovery-composition.patch](https://github.com/PatrickFrome/Compute/blob/78afdeb2e6ad4db33d555ae149aef63d0e3fd133/coordination/source-deliverables/recovery-installed-composition-23e4cd1-20261103/installed-recovery-composition.patch).
   SHA256 `83fc15b9c9100f2dca110b07497ca3df3754b725d69e8e4da630ca764572e4bf`;
   result tree `7aa8184e89a4ca3754275e81bf3f83a61276837b`.

Check SHA256 before each application, use `git apply --check` followed by
`git apply --index`, and compare `git write-tree` after each stage. The archive
source revision is c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6; synthetic local
commit metadata is not its upstream identity.

On that exact baseline apply this delivery's run-core-directory-custody.patch
the same way. Expected result:
`9163f18f17bbcb5ffdb0af6169028afe8e454998`.
