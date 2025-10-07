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
    """Get all accounts for a specific platform"""
    conn = get_db_connection()
    if not conn:
        return []
    
    cursor = conn.cursor(dictionary=True)
    config = PLATFORM_CONFIGS[platform]
    
    # Different query conditions based on platform
    if platform == 'instagram':
        query = f"""
            SELECT {config['id_field']}, {config['name_field']}, {config['token_field']}, google_drive_link
            FROM {config['table']}
            WHERE done = 'No' AND posts_left > 0
        """
    else:
        # For other platforms, get all accounts that might need tokens
        query = f"""
            SELECT {config['id_field']}, {config['name_field']}, {config['token_field']}, google_drive_link
            FROM {config['table']}
            WHERE {config['token_field']} IS NOT NULL OR google_drive_link IS NOT NULL
        """
    
    cursor.execute(query)
    accounts = cursor.fetchall()
    cursor.close()
    conn.close()
    
    # Add platform info to each account
    for account in accounts:
        account['platform'] = platform
        account['config'] = config
    
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
    print(f"Updated {config['token_field']} for {platform} account ID {account_id}")

def get_valid_token_from_other_account(platform, current_account_id):
    """Get a valid token from another account in the same platform"""
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
        print(f"Found {config['token_field']} from another {platform} account.")
        return result[config['token_field']]
    
    print(f"No valid {config['token_field']} found in other {platform} accounts.")
    return None

def get_valid_token_from_any_platform(current_platform, current_account_id):
    """Get a valid token from any platform (fallback)"""
    conn = get_db_connection()
    if not conn:
        return None
    
    cursor = conn.cursor(dictionary=True)
    
    # Try Instagram first (most likely to have tokens)
    query = """
        SELECT token_drive
        FROM instagram
        WHERE token_drive IS NOT NULL AND token_drive != '' AND token_drive != '{}'
        LIMIT 1
    """
    cursor.execute(query)
    result = cursor.fetchone()
    
    if not result:
        # Try Telegram
        query = """
            SELECT token_drive
            FROM telegram
            WHERE token_drive IS NOT NULL AND token_drive != '' AND token_drive != '{}'
            LIMIT 1
        """
        cursor.execute(query)
        result = cursor.fetchone()
    
    if not result:
        # Try YouTube (uses token_sesson)
        query = """
            SELECT token_sesson
            FROM youtube
            WHERE token_sesson IS NOT NULL AND token_sesson != '' AND token_sesson != '{}'
            LIMIT 1
        """
        cursor.execute(query)
        result = cursor.fetchone()
    
    cursor.close()
    conn.close()
    
    if result:
        token_field = list(result.keys())[0]  # Get the field name
        print(f"Found {token_field} from another platform as fallback.")
        return result[token_field]
    
    print("No valid tokens found in any platform.")
    return None

# --- Google Drive Functions ---
def validate_credentials(creds):
    """Validate Google Drive credentials"""
    if not creds:
        return False
    
    try:
        drive_service = build('drive', 'v3', credentials=creds)
        # Test by listing files in root (minimal operation)
        drive_service.files().list(pageSize=1, fields="files(id)").execute()
        print("Credentials are valid.")
        return True
    except Exception as e:
        print(f"Credentials validation failed: {str(e)}")
        return False

def get_or_refresh_credentials(account, max_retries=3):
    """Get or refresh credentials for an account"""
    platform = account['platform']
    config = account['config']
    account_id = account[config['id_field']]
    account_name = account[config['name_field']]
    creds = None
    refreshed = False

    # Load from database if exists
    token_field = config['token_field']
    if account.get(token_field):
        try:
            token_str = account[token_field].strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print(f"Loaded {token_field} from database for {platform} account {account_name}")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"ERROR: Invalid {token_field} for {platform} account {account_name}: {str(e)}. Treating as null.")
            creds = None

    # Try to refresh existing credentials
    if creds:
        if creds.expired and creds.refresh_token:
            for attempt in range(max_retries):
                try:
                    creds.refresh(Request())
                    print(f"Refreshed token for {platform} account {account_name}")
                    update_drive_token(platform, account_id, creds.to_json())
                    refreshed = True
                    break
                except Exception as e:
                    print(f"Refresh attempt {attempt + 1}/{max_retries} failed for {platform} account {account_name}: {str(e)}")
                    if attempt < max_retries - 1:
                        sleep(5)
                    else:
                        print(f"Max retries reached for {platform} account {account_name}. Attempting alternative methods.")
                        creds = None

    # If still no creds, try copying from another account in same platform
    if not creds:
        other_token = get_valid_token_from_other_account(platform, account_id)
        if other_token:
            try:
                token_str = other_token.strip('"').replace('\\"', '"').replace("\\'", "'")
                token_data = json.loads(token_str)
                creds = Credentials.from_authorized_user_info(token_data, SCOPES)
                
                # Validate if it works
                if validate_credentials(creds):
                    # If expired, try refresh
                    if creds.expired and creds.refresh_token:
                        try:
                            creds.refresh(Request())
                            print(f"Refreshed copied token for {platform} account {account_name}")
                        except Exception as e:
                            print(f"Failed to refresh copied token: {str(e)}. Discarding.")
                            creds = None
                    
                    if creds:
                        update_drive_token(platform, account_id, creds.to_json())
                        refreshed = True
                        print(f"Successfully used and saved token from another {platform} account for {account_name}")
                else:
                    print(f"Copied token does not work. Discarding.")
                    creds = None
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                print(f"ERROR: Invalid copied {token_field}: {str(e)}. Skipping.")
                creds = None

    # If still no creds, try copying from any platform (fallback)
    if not creds:
        other_token = get_valid_token_from_any_platform(platform, account_id)
        if other_token:
            try:
                token_str = other_token.strip('"').replace('\\"', '"').replace("\\'", "'")
                token_data = json.loads(token_str)
                creds = Credentials.from_authorized_user_info(token_data, SCOPES)
                
                # Validate if it works
                if validate_credentials(creds):
                    # If expired, try refresh
                    if creds.expired and creds.refresh_token:
                        try:
                            creds.refresh(Request())
                            print(f"Refreshed cross-platform token for {platform} account {account_name}")
                        except Exception as e:
                            print(f"Failed to refresh cross-platform token: {str(e)}. Discarding.")
                            creds = None
                    
                    if creds:
                        update_drive_token(platform, account_id, creds.to_json())
                        refreshed = True
                        print(f"Successfully used and saved cross-platform token for {account_name}")
                else:
                    print(f"Cross-platform token does not work. Discarding.")
                    creds = None
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                print(f"ERROR: Invalid cross-platform token: {str(e)}. Skipping.")
                creds = None

    # If still no creds, attempt new authentication (requires interaction)
    if not creds:
        if not os.path.exists('credentials.json'):
            print(f"ERROR: credentials.json not found for {platform} account {account_name}. Skipping token creation.")
            return None, False
        
        try:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            update_drive_token(platform, account_id, creds.to_json())
            print(f"Obtained and saved new token for {platform} account {account_name}")
            refreshed = True
        except Exception as e:
            print(f"ERROR: Failed to obtain new token for {platform} account {account_name}: {str(e)}. May require manual intervention.")
            return None, False

    return creds, refreshed

def process_platform_accounts(platform):
    """Process all accounts for a specific platform"""
    print(f"\n=== Processing {platform.upper()} Accounts ===")
    accounts = get_all_accounts(platform)
    
    if not accounts:
        print(f"No active {platform} accounts found.")
        return 0, 0
    
    processed = 0
    successful = 0
    
    for account in accounts:
        name_field = PLATFORM_CONFIGS[platform]['name_field']
        id_field = PLATFORM_CONFIGS[platform]['id_field']
        account_name = account[name_field]
        account_id = account[id_field]
        
        print(f"\nProcessing {platform} account: {account_name} (ID: {account_id})")
        processed += 1
        
        # Handle token refresh or creation
        creds, was_refreshed = get_or_refresh_credentials(account)
        if creds:
            successful += 1
            print(f"✓ Token handled successfully for {platform} account {account_name}")
        else:
            print(f"✗ Skipping {platform} account {account_name} due to token issues.")
    
    return processed, successful

# --- Main Execution ---
def main():
    print("=== Multi-Platform Token Refresh Scheduler ===")
    
    while True:
        total_processed = 0
        total_successful = 0
        
        # Process each platform
        for platform in PLATFORM_CONFIGS.keys():
            processed, successful = process_platform_accounts(platform)
            total_processed += processed
            total_successful += successful
        
        print(f"\n=== Scheduler Run Summary ===")
        print(f"Total accounts processed: {total_processed}")
        print(f"Total successful: {total_successful}")
        print(f"Failed: {total_processed - total_successful}")
        
        if total_processed > 0:
            success_rate = (total_successful / total_processed) * 100
            print(f"Success rate: {success_rate:.1f}%")
        
        print(f"\nScheduler run complete. Sleeping for {REFRESH_INTERVAL_SECONDS / 3600} hours...")
        print("=" * 50)
        sleep(REFRESH_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()