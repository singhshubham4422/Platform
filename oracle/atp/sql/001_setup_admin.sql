-- Run as ADMIN in Autonomous Database Serverless (Oracle 23ai).
-- Oracle docs: "CREATE_CREDENTIAL Procedure" (DBMS_CLOUD Subprograms and REST APIs),
-- "DBMS_NETWORK_ACL_ADMIN" (PL/SQL Packages and Types Reference).
-- SQL*Plus substitution values below are supplied interactively; this file contains no secret values.
DEFINE lpkpi_password = '&lpkpi_password'
DEFINE supabase_host = '&supabase_host'
DEFINE oci_user_ocid = '&oci_user_ocid'
DEFINE oci_tenancy_ocid = '&oci_tenancy_ocid'
DEFINE oci_fingerprint = '&oci_fingerprint'
DEFINE oci_private_key_pem = '&oci_private_key_pem'

CREATE USER LPKPI IDENTIFIED BY "&lpkpi_password" QUOTA 5G ON DATA;
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE SEQUENCE, CREATE JOB TO LPKPI;
GRANT EXECUTE ON DBMS_CLOUD TO LPKPI;
GRANT EXECUTE ON DBMS_SCHEDULER TO LPKPI;

BEGIN
  DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE(
    host => '&supabase_host', lower_port => 443, upper_port => 443,
    ace => XS$ACE_TYPE(privilege_list => XS$NAME_LIST('connect','resolve'), principal_name => 'LPKPI', principal_type => XS_ACL.PTYPE_DB)
  );
  DBMS_CLOUD.CREATE_CREDENTIAL(
    credential_name => 'LP_OCI_CRED', user_ocid => '&oci_user_ocid',
    tenancy_ocid => '&oci_tenancy_ocid', private_key => '&oci_private_key_pem',
    fingerprint => '&oci_fingerprint', comments => 'LPKPI Object Storage API signing key'
  );
END;
/

-- OCI Vault/resource principal alternative: enable it with DBMS_CLOUD_ADMIN.ENABLE_RESOURCE_PRINCIPAL,
-- grant the ADB dynamic group Object Storage read access, then use OCI$RESOURCE_PRINCIPAL instead of LP_OCI_CRED.
