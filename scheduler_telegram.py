import subprocess
import mysql.connector
from datetime import datetime, time, timedelta
import pytz
from time import sleep
import os
# --- Configuration ---
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
TIMEZONE = pytz.timezone('Asia/Kolkata')

# --- Helper Functions ---
def get_db_connection():
    """Establish connection to the MySQL database."""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def timedelta_to_time(td):
    """Convert timedelta object from DB to a time object."""
    if td is None:
        return None
    total_seconds = int(td.total_seconds())
    return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)

def get_earliest_post_time(table):
    """Fetch the earliest next_post_time from the specified table."""
    conn = get_db_connection()
    if not conn:
        print(f"ERROR: Failed to connect to database when querying {table}.")
        return None
    cursor = conn.cursor()
    query = f"SELECT MIN(next_post_time) AS earliest_time FROM {table} WHERE selected = 'Yes' AND done = 'No' AND posts_left > 0 AND next_post_time IS NOT NULL"
    cursor.execute(query)
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    return result[0] if result and result[0] else None

# --- Main Logic ---
def run_scheduler_once():
    """
    Connects to the DB to update 'done', 'selected', and 'next_post_time' statuses.
    Runs post_on_telegram.py if there are scheduled Telegram posts.
    """
    conn = get_db_connection()
    if not conn:
        print("ERROR: Failed to connect to database. Exiting.")
        return

    cursor = conn.cursor(dictionary=True)
    
    # Get the current time in the specified timezone ('Asia/Kolkata')
    now = datetime.now(TIMEZONE)
    current_time = now.time()
    
    print(f"\n--- Running Scheduler at {now.strftime('%Y-%m-%d %H:%M:%S %Z')} ---")

    table = 'telegram'
    print(f"\nProcessing table: {table}\n")
    
    cursor.execute(f"SELECT id, sch_start_range, sch_end_range, posts_left FROM {table}")
    rows = cursor.fetchall()

    for row in rows:
        row_id = row['id']
        
        # 1. Reset 'done' status if posts are left.
        if row['posts_left'] > 0:
            cursor.execute(f"UPDATE {table} SET done = 'No' WHERE id = %s", (row_id,))
            print(f"  - ID {row_id}: posts_left > 0. Ensured 'done' is 'No'.")

        # 2. Check schedule and update 'selected' and 'next_post_time'.
        start_time = timedelta_to_time(row['sch_start_range'])
        end_time = timedelta_to_time(row['sch_end_range'])

        if not start_time or not end_time:
            print(f"  - ID {row_id}: Missing schedule range. Cannot select.")
            continue

        # Check if the current time is within the allowed range and there are posts left
        if start_time <= current_time <= end_time and row['posts_left'] > 0:
            # Set 'selected' to 'Yes'
            cursor.execute(f"UPDATE {table} SET selected = 'Yes' WHERE id = %s", (row_id,))
            print(f"  - ID {row_id}: Is within schedule. Set 'selected' to 'Yes'.")

            # Calculate next_post_time based on IST
            end_datetime = now.replace(hour=end_time.hour, minute=end_time.minute, second=end_time.second, microsecond=0)
            
            if end_datetime < now:
                end_datetime += timedelta(days=1)

            time_left = end_datetime - now
            posts_left = row['posts_left']
            
            if posts_left > 0 and time_left.total_seconds() > 0:
                interval = time_left / posts_left
                next_post_time = now + interval
                
                # Store the calculated time in IST
                cursor.execute(f"UPDATE {table} SET next_post_time = %s WHERE id = %s", (next_post_time, row_id))
                print(f"    -> Calculated next post time: {next_post_time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
        else:
            # If not in range, ensure 'selected' is 'No' and clear the next post time
            cursor.execute(f"UPDATE {table} SET selected = 'No', next_post_time = NULL WHERE id = %s", (row_id,))

    # Commit all changes made during this run
    conn.commit()
    cursor.close()
    conn.close()
    print("\n--- Scheduler run complete ---\n")
    sleep(3)

    # Check for scheduled Telegram posts
    telegram_time = get_earliest_post_time('telegram')

    print("Checking earliest post time for Telegram:")
    print(f"  Telegram: {telegram_time.strftime('%Y-%m-%d %H:%M:%S %Z') if telegram_time else 'No scheduled posts'}")

    if not telegram_time:
        print("No Telegram posts scheduled. Exiting.")
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_telegram.py")])

        return
    else:
        print("Running post_on_telegram.py...")
        sleep(3)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_telegram.py")])

if __name__ == "__main__":
    run_scheduler_once()