import os
import re
import json
from time import sleep
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import mysql.connector
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database configuration from environment variables
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}

SCOPES = ["https://www.googleapis.com/auth/drive"]
REFRESH_INTERVAL_SECONDS = 3600  # 1 hour

# Platform table configurations
PLATFORM_CONFIGS = {
    'instagram': {
        'table': 'instagram',
        'token_field': 'token_drive',
        'id_field': 'id',
        'name_field': 'username'
    },
    'telegram': {
        'table': 'telegram',
        'token_field': 'token_drive',
        'id_field': 'id',
        'name_field': 'channel_name'
    },
    'youtube': {
        'table': 'youtube',
        'token_field': 'token_sesson',  # YouTube uses token_sesson for Drive
        'id_field': 'id',
        'name_field': 'username'
    }
}

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def get_all_accounts(platform):
    """
    Get ALL accounts with a Google Drive link, ensuring token fields are not NULL.
    Sets NULL token values to the string '{}'.
    """
    conn = get_db_connection()
    if not conn:
        return []
    
    # Use buffered=True to handle potential large results and ensure connection integrity
    cursor = conn.cursor(dictionary=True, buffered=True) 
    config = PLATFORM_CONFIGS[platform]
    
    # Use COALESCE in SQL to replace NULL with '{}' directly in the result set
    token_field_coalesced = f"COALESCE({config['token_field']}, '{{}}') AS {config['token_field']}"
    
    # Query: Select all rows where google_drive_link is not NULL
    query = f"""
        SELECT {config['id_field']}, {config['name_field']}, {token_field_coalesced}, google_drive_link
        FROM {config['table']}
        WHERE google_drive_link IS NOT NULL 
    """
    
    # Print minimized query for terminal
    print(f"Query ({platform}): {re.sub(r'\s+', ' ', query.strip())[:100]}...")
    
    try:
        cursor.execute(query)
        accounts = cursor.fetchall()
    except mysql.connector.Error as e:
        print(f"ERROR: SQL execution failed for {platform}: {str(e)}")
        accounts = []
    finally:
        cursor.close()
        conn.close()
    
    # Add platform info to each account
    for account in accounts:
        account['platform'] = platform
        account['config'] = config
    
    print(f"Retrieved {len(accounts)} relevant accounts for {platform}.")
    return accounts

def update_drive_token(platform, account_id, token_json):
    """Update token for a specific platform account"""
    conn = get_db_connection()
    if not conn:
        return
    
    cursor = conn.cursor()
    config = PLATFORM_CONFIGS[platform]
    
    query = f"UPDATE {config['table']} SET {config['token_field']} = %s WHERE {config['id_field']} = %s"
    cursor.execute(query, (token_json, account_id))
    conn.commit()
    cursor.close()
    conn.close()

# Note: get_valid_token_from_other_account and get_valid_token_from_any_platform 
# remain unchanged as they filter out '{}' which is the correct behavior for 
# finding a truly *working* token.

def get_valid_token_from_other_account(platform, current_account_id):
    """
    Get a valid token from another account in the same platform. 
    A valid token is defined as not NULL, not empty string, and not '{}'.
    """
    conn = get_db_connection()
    if not conn:
        return None
    
    cursor = conn.cursor(dictionary=True)
    config = PLATFORM_CONFIGS[platform]
    
    query = f"""
        SELECT {config['token_field']}
        FROM {config['table']}
        WHERE {config['id_field']} != %s 
        AND {config['token_field']} IS NOT NULL 
        AND {config['token_field']} != '' 
        AND {config['token_field']} != '{{}}'
        LIMIT 1
    """
    cursor.execute(query, (current_account_id,))
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if result:
        return result[config['token_field']]
    
    return None

def get_valid_token_from_any_platform(current_platform, current_account_id):
    """
    Get a valid token from any platform (fallback). 
    A valid token is defined as not NULL, not empty string, and not '{}'.
    """
    conn = get_db_connection()
    if not conn:
        return None
    
    cursor = conn.cursor(dictionary=True)
    
    platform_checks = [
        ('instagram', 'token_drive'),
        ('telegram', 'token_drive'),
        ('youtube', 'token_sesson')
    ]
    
    for table, token_field in platform_checks:
        query = f"""
            SELECT {token_field}
            FROM {table}
            WHERE {token_field} IS NOT NULL AND {token_field} != '' AND {token_field} != '{{}}'
            LIMIT 1
        """
        cursor.execute(query)
        result = cursor.fetchone()
        
        if result:
            cursor.close()
            conn.close()
            return result[token_field]
    
    cursor.close()
    conn.close()
    return None


def validate_credentials(creds):
    """Validate Google Drive credentials"""
    if not creds:
        return False
    
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        drive_service.files().list(pageSize=1, fields="files(id)").execute()
        return True
    except Exception as e:
        return False

def get_or_refresh_credentials(account, max_retries=3):
    """
    Attempt to refresh, validate, or set credentials unconditionally.
    Returns creds, status_code, and action_performed for concise logging.
    """
    platform = account['platform']
    config = account['config']
    account_id = account[config['id_field']]
    account_name = account[config['name_field']]
    creds = None
    token_field = config['token_field']
    
    current_token_value = account.get(token_field)
    action = 'FAILED'

    # 1. Attempt to load existing credentials (now guaranteed not NULL, might be '{}')
    if current_token_value and current_token_value.strip() != '{}' and current_token_value.strip() != '':
        try:
            token_str = current_token_value.strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            action = 'LOADED'

            # Try to refresh/validate existing credentials
            is_valid = validate_credentials(creds)
            
            if creds.expired and creds.refresh_token:
                for attempt in range(max_retries):
                    try:
                        creds.refresh(Request())
                        update_drive_token(platform, account_id, creds.to_json())
                        action = 'REFRESHED'
                        is_valid = True
                        break
                    except Exception:
                        action = 'REFRESH_FAIL'
                        sleep(1)
            
            if is_valid and creds:
                action = action if action == 'REFRESHED' else 'VALIDATED'
                return creds, 1, action
            elif creds:
                 # Token was present but failed validation/refresh
                 action = 'INVALID'
                 creds = None 
        
        except (json.JSONDecodeError, KeyError, ValueError):
            action = 'MALFORMED'
            creds = None

    # 2. Fallback: Try copying a token from another account (runs if token was '{}', NULL, or INVALID/MALFORMED)
    if not creds:
        other_token = get_valid_token_from_other_account(platform, account_id)
        if not other_token:
            other_token = get_valid_token_from_any_platform(platform, account_id)

        if other_token:
            try:
                token_str = other_token.strip('"').replace('\\"', '"').replace("\\'", "'")
                token_data = json.loads(token_str)
                creds = Credentials.from_authorized_user_info(token_data, SCOPES)
                
                if validate_credentials(creds):
                    # Attempt refresh once, even for copied token
                    if creds.expired and creds.refresh_token:
                        try:
                            creds.refresh(Request())
                        except Exception:
                            pass # Use as-is if refresh fails
                    
                    if creds:
                        update_drive_token(platform, account_id, creds.to_json())
                        action = 'COPIED_SET'
                        return creds, 1, action
                else:
                    action = 'COPIED_BAD'
                    creds = None
            except Exception:
                action = 'COPIED_FAIL'
                creds = None

    # 3. Final Fallback: Attempt new interactive authentication
    if not creds:
        if not os.path.exists('credentials.json'):
            action = 'NO_CRED_FILE'
            return None, 0, action
        
        try:
            # Note: This is blocking and requires manual intervention
            print(f"--- INTERACTIVE AUTH REQUIRED for {account_name} ---")
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            update_drive_token(platform, account_id, creds.to_json())
            action = 'NEW_AUTH_SET'
            return creds, 1, action
        except Exception:
            action = 'NEW_AUTH_FAIL'
            return None, 0, action

    return None, 0, action


def process_platform_accounts(platform):
    """Process all accounts for a specific platform and log concisely."""
    print(f"\n--- {platform.upper()} Processing (Total: {len(get_all_accounts(platform))}) ---\n")
    
    accounts = get_all_accounts(platform)
    
    if not accounts:
        print(f"No relevant {platform} accounts found.")
        return 0, 0
    
    processed = 0
    successful = 0
    
    # Header for the concise output formula
    print(f"{'| ID':<5} | {'Platform':<10} | {'Account Name':<20} | {'Status':<10} | {'Action':<15} |")
    print("-" * 65)

    for account in accounts:
        name_field = PLATFORM_CONFIGS[platform]['name_field']
        id_field = PLATFORM_CONFIGS[platform]['id_field']
        account_name = account[name_field]
        account_id = account[id_field]
        
        processed += 1
        
        # Unconditional attempt to get or refresh credentials
        creds, status, action = get_or_refresh_credentials(account)
        
        # Determine final status for output
        status_str = "SUCCESS" if status == 1 else "FAILED"
        
        # Print concise "terminal bit formula" (one line per account)
        print(f"| {account_id:<3} | {platform:<10} | {account_name:<20} | {status_str:<10} | {action:<15} |")
        
        if status == 1:
            successful += 1
    
    return processed, successful

# --- Main Execution ---
def main():
    print("=== Multi-Platform Token Refresh Scheduler (UNCONDITIONAL RUN) ===")
    
    while True:
        total_processed = 0
        total_successful = 0
        
        # Process each platform (runs the logic for ALL rows in each table)
        for platform in PLATFORM_CONFIGS.keys():
            processed, successful = process_platform_accounts(platform)
            total_processed += processed
            total_successful += successful
        
        print(f"\n\n=== Scheduler Run Summary ===")
        print(f"Total processed: {total_processed}, Successful: {total_successful}, Failed: {total_processed - total_successful}")
        
        if total_processed > 0:
            success_rate = (total_successful / total_processed) * 100
            print(f"Success rate: {success_rate:.1f}%")
        
        print(f"\nScheduler run complete. Sleeping for {REFRESH_INTERVAL_SECONDS / 3600} hours...")
        print("=" * 65)
        sleep(REFRESH_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()