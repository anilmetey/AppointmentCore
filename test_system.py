import urllib.request
import urllib.error
import json
import threading
import time
import sys
import os
from datetime import date, datetime, timedelta

BASE_URL = os.environ.get("APPOINTMENT_API_URL", "http://localhost:5192/api")

def next_weekday(target_weekday, weeks_ahead=0):
    today = date.today()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return today + timedelta(days=days_ahead + (7 * weeks_ahead))

def make_request(url, method="GET", data=None, token=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    
    body = None
    if data:
        body = json.dumps(data).encode("utf-8")
        
    try:
        with urllib.request.urlopen(req, data=body, timeout=10) as response:
            status = response.status
            resp_data = response.read().decode("utf-8")
            return status, json.loads(resp_data) if resp_data else {}
    except urllib.error.HTTPError as e:
        status = e.code
        resp_data = e.read().decode("utf-8")
        try:
            return status, json.loads(resp_data) if resp_data else {"error": e.reason}
        except:
            return status, {"error": resp_data or e.reason}
    except Exception as e:
        return 500, {"error": str(e)}

def get_tokens():
    print("[*] Logging in users and managers...")
    # Customer 1 (Ali)
    _, res1 = make_request(f"{BASE_URL}/auth/login", "POST", {"email": "ali@customer.com", "password": "Customer123!"})
    token_ali = res1.get("token")
    
    # Customer 2 (Ayşe)
    _, res2 = make_request(f"{BASE_URL}/auth/login", "POST", {"email": "ayse@customer.com", "password": "Customer123!"})
    token_ayse = res2.get("token")

    # Manager Istanbul
    _, res3 = make_request(f"{BASE_URL}/auth/login", "POST", {"email": "ist_manager@system.com", "password": "Manager123!"})
    token_manager = res3.get("token")

    # Global Admin
    _, res4 = make_request(f"{BASE_URL}/auth/login", "POST", {"email": "admin@system.com", "password": "Admin123!"})
    token_admin = res4.get("token")

    return token_ali, token_ayse, token_manager, token_admin

def test_dynamic_slots():
    print("\n=== TEST 1: Dynamic Timezone & Slot Calculation ===")
    # Ahmet (Employee ID: 3) works 09:00 - 18:00 (Istanbul Time is UTC+3)
    # Lunch break: 12:00 - 13:00 Istanbul time
    # Service ID 1 (Haircut): 45 mins.
    # Use a future Monday so the verification remains valid over time.
    test_date = next_weekday(0)
    status, slots = make_request(f"{BASE_URL}/branch/1/employees/3/slots?serviceId=1&date={test_date.isoformat()}")
    
    if status != 200:
        print(f"[-] Failed to fetch slots. Status: {status}, Response: {slots}")
        return False

    print(f"[+] Successfully fetched {len(slots)} available slots.")
    
    # 09:00 Istanbul time should map to 06:00 UTC (due to GMT+3 offset)
    expected_first_slot = f"{test_date.isoformat()}T06:00:00Z"
    if expected_first_slot in slots:
        print(f"[+] Slot timezone conversion check PASSED: Local 09:00 converted to UTC 06:00 ({expected_first_slot}).")
    else:
        print(f"[-] Slot timezone conversion check FAILED: {expected_first_slot} not found in slots. Slots: {slots[:3]}...")
        return False

    # Lunch hours 12:00 - 13:00 Istanbul time = 09:00 - 10:00 UTC
    # Any slots starting between 09:00 UTC and 09:59 UTC must be blocked.
    lunch_overlap = False
    for slot in slots:
        slot_time = datetime.fromisoformat(slot.replace("Z", "+00:00")).time()
        if datetime.strptime("09:00", "%H:%M").time() <= slot_time < datetime.strptime("10:00", "%H:%M").time():
            lunch_overlap = True
            print(f"[-] Lunch overlap check FAILED: Found slot during lunch mola: {slot}")
            break
            
    if not lunch_overlap:
        print("[+] Lunch break filtering check PASSED: No slots generated during lunch hours (09:00-10:00 UTC).")
        return True
    return False

def test_security_tampering(token_manager, token_admin):
    print("\n=== TEST 2: JWT Security & Multi-Tenant ID Tampering ===")
    
    # Istanbul Manager (belongs to branch 1) tries to fetch Branch 2 appointments
    status, res = make_request(f"{BASE_URL}/branch/2/appointments", "GET", token=token_manager)
    
    if status == 403:
        print("[+] ID Tampering prevention PASSED: Manager belonging to Branch 1 was BLOCKED (403 Forbidden) from accessing Branch 2.")
    else:
        print(f"[-] ID Tampering prevention FAILED: Expected 403, got {status}. Response: {res}")
        return False

    # Let's verify if the attempt is recorded in SecurityLogs
    print("[*] Querying security logs as Admin...")
    log_status, logs = make_request(f"{BASE_URL}/appointment/security-logs", "GET", token=token_admin)
    if log_status == 200 and len(logs) > 0:
        latest_log = logs[0]
        if latest_log.get("action") == "UNAUTHORIZED_BRANCH_ACCESS_ATTEMPT":
            print(f"[+] Security Auditing PASSED: Found log record: '{latest_log.get('details')}'")
            return True
        else:
            print(f"[-] Security Auditing FAILED: Latest log action was {latest_log.get('action')}, expected 'UNAUTHORIZED_BRANCH_ACCESS_ATTEMPT'.")
    else:
        print(f"[-] Security Auditing FAILED: Logs empty or request failed. Status: {log_status}")
    return False

def test_concurrency_race_condition(token_ali, token_ayse):
    print("\n=== TEST 3: Concurrency Race Condition Prevention (50 Requests) ===")
    test_date = next_weekday(0, weeks_ahead=1)
    slot_status, slots = make_request(
        f"{BASE_URL}/branch/1/employees/3/slots?serviceId=1&date={test_date.isoformat()}"
    )
    if slot_status != 200 or not slots:
        print(f"[-] Could not obtain a slot for concurrency test. Status: {slot_status}, Response: {slots}")
        return False
    slot_time = slots[0]
    
    results = []
    threads = []
    barrier = threading.Barrier(50)
    
    def send_concurrent_booking(token, index):
        # We synchronize threads using a barrier so they send HTTP requests at the exact same millisecond
        barrier.wait()
        # Alternate customers to test multiple accounts booking simultaneously
        active_token = token_ali if index % 2 == 0 else token_ayse
        status, response = make_request(
            f"{BASE_URL}/appointment", 
            "POST", 
            {
                "employeeId": 3,
                "serviceId": 1,
                "startTimeUtc": slot_time
            }, 
            token=active_token
        )
        results.append((status, response))

    for i in range(50):
        t = threading.Thread(target=send_concurrent_booking, args=(token_ali, i))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # Analyze results
    success_count = 0
    conflict_count = 0
    other_count = 0
    
    for status, resp in results:
        if status == 201:
            success_count += 1
        elif status == 422:
            conflict_count += 1
        else:
            other_count += 1
            print(f"[-] Unexpected status: {status}, Response: {resp}")

    print(f"[*] Booking Concurrency Results Summary:")
    print(f"    - Successful Bookings (HTTP 201): {success_count}")
    print(f"    - Blocked Overlaps (HTTP 422 Conflict): {conflict_count}")
    print(f"    - Other responses: {other_count}")

    if success_count == 1 and conflict_count == 49:
        print("[+] Concurrency booking check PASSED: Exactly 1 reservation succeeded, and 49 were blocked (Race Condition successfully resolved).")
        return True
    else:
        print(f"[-] Concurrency booking check FAILED: Expected 1 success and 49 conflicts, got {success_count} success and {conflict_count} conflicts.")
        return False

def test_reschedule(token_ali, token_ayse):
    print("\n=== TEST 4: Secure Appointment Rescheduling ===")
    test_date = next_weekday(0, weeks_ahead=2)
    slot_status, slots = make_request(
        f"{BASE_URL}/branch/1/employees/3/slots?serviceId=1&date={test_date.isoformat()}"
    )
    if slot_status != 200 or len(slots) < 9:
        print(f"[-] Could not obtain enough slots. Status: {slot_status}, Response: {slots}")
        return False

    create_status, appointment = make_request(
        f"{BASE_URL}/appointment", "POST",
        {"employeeId": 3, "serviceId": 1, "startTimeUtc": slots[0]}, token_ali
    )
    if create_status != 201:
        print(f"[-] Setup booking failed. Status: {create_status}, Response: {appointment}")
        return False

    appointment_id = appointment.get("id")
    move_status, _ = make_request(
        f"{BASE_URL}/appointment/{appointment_id}/reschedule", "PUT",
        {"startTimeUtc": slots[4]}, token_ali
    )
    forbidden_status, _ = make_request(
        f"{BASE_URL}/appointment/{appointment_id}/reschedule", "PUT",
        {"startTimeUtc": slots[8]}, token_ayse
    )
    _, refreshed_slots = make_request(
        f"{BASE_URL}/branch/1/employees/3/slots?serviceId=1&date={test_date.isoformat()}"
    )

    passed = move_status == 200 and forbidden_status == 403 \
        and slots[0] in refreshed_slots and slots[4] not in refreshed_slots
    if passed:
        print("[+] Rescheduling PASSED: owner moved the booking, old slot reopened, and another customer was blocked.")
    else:
        print(f"[-] Rescheduling FAILED: move={move_status}, unauthorized={forbidden_status}")
    return passed

def test_password_change(token_ali):
    print("\n=== TEST 5: Password Change Security ===")
    weak_status, _ = make_request(
        f"{BASE_URL}/auth/password", "PUT",
        {"currentPassword": "Customer123!", "newPassword": "weakpass"}, token_ali
    )
    wrong_status, _ = make_request(
        f"{BASE_URL}/auth/password", "PUT",
        {"currentPassword": "Wrong123!", "newPassword": "NewCustomer456!"}, token_ali
    )
    change_status, _ = make_request(
        f"{BASE_URL}/auth/password", "PUT",
        {"currentPassword": "Customer123!", "newPassword": "NewCustomer456!"}, token_ali
    )
    old_login_status, _ = make_request(
        f"{BASE_URL}/auth/login", "POST",
        {"email": "ali@customer.com", "password": "Customer123!"}
    )
    new_login_status, new_login = make_request(
        f"{BASE_URL}/auth/login", "POST",
        {"email": "ali@customer.com", "password": "NewCustomer456!"}
    )

    if new_login_status == 200:
        make_request(
            f"{BASE_URL}/auth/password", "PUT",
            {"currentPassword": "NewCustomer456!", "newPassword": "Customer123!"},
            new_login.get("token")
        )

    passed = weak_status == 400 and wrong_status == 400 \
        and change_status == 200 and old_login_status == 401 and new_login_status == 200
    print("[+] Password security PASSED: policy, current password, and credential rotation verified." if passed
          else f"[-] Password security FAILED: weak={weak_status}, wrong={wrong_status}, change={change_status}, old={old_login_status}, new={new_login_status}")
    return passed

def test_earliest_availability():
    print("\n=== TEST 6: Cross-Staff Earliest Availability Search ===")
    test_date = next_weekday(0)
    status, result = make_request(
        f"{BASE_URL}/branch/1/earliest-slot?serviceId=1&fromDate={test_date.isoformat()}&days=14"
    )
    invalid_status, _ = make_request(
        f"{BASE_URL}/branch/1/earliest-slot?serviceId=1&fromDate={test_date.isoformat()}&days=32"
    )

    passed = status == 200 and invalid_status == 400 \
        and result.get("employeeId") == 3 \
        and result.get("slotUtc") == f"{test_date.isoformat()}T06:00:00Z"
    if passed:
        print("[+] Earliest availability PASSED: all staff calendars were searched and the first valid slot was returned.")
    else:
        print(f"[-] Earliest availability FAILED: status={status}, invalidRange={invalid_status}, result={result}")
    return passed

def test_completion_guards(token_ali):
    print("\n=== TEST 7: Completion Guards & Customer-Safe Branches ===")
    branches_status, branches = make_request(f"{BASE_URL}/branch")
    invalid_date_status, _ = make_request(
        f"{BASE_URL}/branch/1/employees/3/slots?serviceId=1&date=06/22/2026"
    )

    test_date = next_weekday(0, weeks_ahead=3)
    _, slots = make_request(
        f"{BASE_URL}/branch/1/employees/3/slots?serviceId=1&date={test_date.isoformat()}"
    )
    if not slots:
        print("[-] Could not obtain a slot for cancellation guard test.")
        return False

    create_status, appointment = make_request(
        f"{BASE_URL}/appointment", "POST",
        {"employeeId": 3, "serviceId": 1, "startTimeUtc": slots[0]}, token_ali
    )
    first_cancel_status, _ = make_request(
        f"{BASE_URL}/appointment/{appointment.get('id')}", "DELETE", token=token_ali
    ) if create_status == 201 else (0, {})
    repeated_cancel_status, _ = make_request(
        f"{BASE_URL}/appointment/{appointment.get('id')}", "DELETE", token=token_ali
    ) if create_status == 201 else (0, {})

    passed = branches_status == 200 and len(branches) == 1 \
        and branches[0].get("id") == 1 and invalid_date_status == 400 \
        and create_status == 201 and first_cancel_status == 200 and repeated_cancel_status == 422
    if passed:
        print("[+] Completion guards PASSED: empty branches hidden, strict dates enforced, repeated cancellation blocked.")
    else:
        print(f"[-] Completion guards FAILED: branches={branches}, invalidDate={invalid_date_status}, create={create_status}, cancels={first_cancel_status}/{repeated_cancel_status}")
    return passed

def main():
    token_ali, token_ayse, token_manager, token_admin = get_tokens()
    if not token_ali or not token_ayse or not token_manager or not token_admin:
        print("[-] Authentication failed. Exiting.")
        sys.exit(1)

    t1 = test_dynamic_slots()
    t2 = test_security_tampering(token_manager, token_admin)
    t3 = test_concurrency_race_condition(token_ali, token_ayse)
    t4 = test_reschedule(token_ali, token_ayse)
    t5 = test_password_change(token_ali)
    t6 = test_earliest_availability()
    t7 = test_completion_guards(token_ali)
    
    print("\n=== VERIFICATION RESULTS SUMMARY ===")
    print(f"Test 1 - Dynamic Slots:    {'PASSED' if t1 else 'FAILED'}")
    print(f"Test 2 - JWT & RBAC Log:   {'PASSED' if t2 else 'FAILED'}")
    print(f"Test 3 - Race Condition:   {'PASSED' if t3 else 'FAILED'}")
    print(f"Test 4 - Rescheduling:     {'PASSED' if t4 else 'FAILED'}")
    print(f"Test 5 - Password Change:  {'PASSED' if t5 else 'FAILED'}")
    print(f"Test 6 - Smart Search:      {'PASSED' if t6 else 'FAILED'}")
    print(f"Test 7 - Completion Guards: {'PASSED' if t7 else 'FAILED'}")
    
    if t1 and t2 and t3 and t4 and t5 and t6 and t7:
        print("\n[+] ALL TESTS COMPLETED SUCCESSFULLY! SYSTEM ARCHITECTURE IS ROBUST.")
        sys.exit(0)
    else:
        print("\n[-] SOME TESTS FAILED. CHECK LOGS ABOVE.")
        sys.exit(1)

if __name__ == "__main__":
    main()
